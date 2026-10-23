import hmac
import os
import time
from collections import deque
from datetime import datetime
from threading import Lock
from uuid import uuid4
from zoneinfo import ZoneInfo

from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)

IST = ZoneInfo("Asia/Kolkata")
SUPPORTED_LANGUAGES = ["en", "hi", "mr"]
MAX_ANNOUNCEMENT_LENGTH = 150
MAX_NAME_LENGTH = 40
MAX_REMINDERS = 8
DEVICE_ONLINE_SECONDS = 40

# Set these three in Render > Environment
DEVICE_KEY = os.environ.get("DEVICE_KEY", "")
ADMIN_USER = os.environ.get("ADMIN_USER", "")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "")

lock = Lock()
reminders = []
last_announcement = None
announcement_queue = deque()
dose_log = deque(maxlen=20)
device = {"lastSeen": 0.0, "rssi": None, "langs": []}
reminders_edited = False


def current_time():
    return datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")


def same(a, b):
    return hmac.compare_digest(str(a).encode(), str(b).encode())


def build_speak_text(name, language):
    if language == "hi":
        return f"अब {name} लेने का समय हो गया है।"
    if language == "mr":
        return f"आता {name} घेण्याची वेळ झाली आहे."
    return f"It is time to take your medicine: {name}."


def read_reminder(data):
    name = str(data.get("medicineName", "")).strip()
    time_value = str(data.get("time", "")).strip()
    language = data.get("language", "en")
    repeat = data.get("repeat", "daily")

    if not name or len(name) > MAX_NAME_LENGTH:
        return None, f"Medicine name is required (maximum {MAX_NAME_LENGTH} characters)."
    try:
        datetime.strptime(time_value, "%H:%M")
    except ValueError:
        return None, "Enter a valid time."
    if language not in SUPPORTED_LANGUAGES:
        return None, "Select a valid language."
    if repeat not in ("daily", "once"):
        return None, "Select a valid repeat option."

    return {
        "medicineName": name,
        "time": time_value,
        "language": language,
        "repeat": repeat,
    }, None


@app.before_request
def require_auth():
    # ESP32 endpoints: secret key header
    if request.path.startswith("/api/device/"):
        key = request.headers.get("X-Device-Key", "")
        if not DEVICE_KEY or not same(key, DEVICE_KEY):
            return jsonify({"success": False, "message": "Unauthorized device."}), 401
        return None

    # Web page and web API: username + password
    if ADMIN_USER and ADMIN_PASS:
        auth = request.authorization
        if (not auth
                or not same(auth.username or "", ADMIN_USER)
                or not same(auth.password or "", ADMIN_PASS)):
            return Response("Login required.", 401,
                            {"WWW-Authenticate": 'Basic realm="Voice System"'})
    return None


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def get_status():
    with lock:
        seen = device["lastSeen"]
        online = bool(seen) and (time.time() - seen) < DEVICE_ONLINE_SECONDS
        langs = list(device["langs"]) if online else []
        rssi = device["rssi"]
        latest = last_announcement.copy() if last_announcement else None
        pending = len(announcement_queue)
        dose = dose_log[-1].copy() if dose_log else None

    return jsonify({
        "online": True,
        "server": "Flask server on Render",
        "deviceOnline": online,
        "rssi": rssi,
        "ttsLanguages": langs,
        "lastAnnouncement": latest,
        "pendingAnnouncements": pending,
        "lastDose": dose,
    })


@app.route("/api/announce", methods=["POST"])
def announce():
    global last_announcement
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    language = data.get("language", "")

    if not text:
        return jsonify({"success": False, "message": "Please enter announcement text."}), 400
    if len(text) > MAX_ANNOUNCEMENT_LENGTH:
        return jsonify({"success": False,
                        "message": f"Announcement must be {MAX_ANNOUNCEMENT_LENGTH} characters or less."}), 400
    if language not in SUPPORTED_LANGUAGES:
        return jsonify({"success": False, "message": "Select a valid language."}), 400

    announcement = {"id": str(uuid4())[:8], "text": text,
                    "language": language, "time": current_time()}
    with lock:
        last_announcement = announcement.copy()
        announcement_queue.append(announcement.copy())

    return jsonify({
        "success": True,
        "message": "Announcement queued. The ESP32 will speak it within about 15 seconds.",
        "announcement": announcement,
    })


# ---------- ESP32 endpoints ----------

@app.route("/api/device/poll", methods=["GET"])
def device_poll():
    with lock:
        device["lastSeen"] = time.time()
        device["rssi"] = request.args.get("rssi", type=int)
        langs = request.args.get("langs", "").split(",")
        device["langs"] = [l for l in langs if l in SUPPORTED_LANGUAGES]

        announcement = announcement_queue.popleft() if announcement_queue else None
        # After a server restart the list is empty and unedited: tell the
        # ESP32 not to wipe the schedule it saved in flash.
        valid = reminders_edited or len(reminders) > 0
        schedule = [{
            "id": r["id"],
            "time": r["time"],
            "language": r["language"],
            "repeat": r["repeat"],
            "speakText": build_speak_text(r["medicineName"], r["language"]),
        } for r in reminders]

    return jsonify({
        "success": True,
        "announcement": announcement,
        "scheduleValid": valid,
        "reminders": schedule,
    })


@app.route("/api/device/ack", methods=["POST"])
def device_ack():
    global reminders_edited
    data = request.get_json(silent=True) or {}
    reminder_id = str(data.get("id", ""))
    status = data.get("status", "taken")

    if status not in ("taken", "missed"):
        return jsonify({"success": False, "message": "Invalid status."}), 400

    with lock:
        reminder = next((r for r in reminders if r["id"] == reminder_id), None)
        if reminder is None:
            return jsonify({"success": False, "message": "Unknown reminder."}), 404
        dose_log.append({"medicineName": reminder["medicineName"],
                         "status": status, "time": current_time()})
        if reminder["repeat"] == "once":
            reminders.remove(reminder)
            reminders_edited = True

    return jsonify({"success": True})


# ---------- Reminder CRUD for the web page ----------

@app.route("/api/reminders", methods=["GET"])
def get_reminders():
    search = request.args.get("search", "").strip().lower()
    with lock:
        results = [r.copy() for r in reminders
                   if search in r["medicineName"].lower()
                   or search in r["language"].lower()]
    return jsonify({"success": True, "reminders": results})


@app.route("/api/reminders", methods=["POST"])
def add_reminder():
    global reminders_edited
    reminder, error = read_reminder(request.get_json(silent=True) or {})
    if error:
        return jsonify({"success": False, "message": error}), 400

    with lock:
        if len(reminders) >= MAX_REMINDERS:
            return jsonify({"success": False,
                            "message": f"Maximum {MAX_REMINDERS} reminders allowed."}), 400
        reminder["id"] = str(uuid4())[:8]
        reminders.append(reminder.copy())
        reminders_edited = True

    return jsonify({"success": True, "message": "Reminder saved.",
                    "reminder": reminder}), 201


@app.route("/api/reminders/<reminder_id>", methods=["PUT"])
def update_reminder(reminder_id):
    global reminders_edited
    data, error = read_reminder(request.get_json(silent=True) or {})
    if error:
        return jsonify({"success": False, "message": error}), 400

    with lock:
        for reminder in reminders:
            if reminder["id"] == reminder_id:
                reminder.update(data)
                reminders_edited = True
                updated = reminder.copy()
                break
        else:
            return jsonify({"success": False, "message": "Reminder not found."}), 404

    return jsonify({"success": True, "message": "Reminder updated.",
                    "reminder": updated})


@app.route("/api/reminders/<reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    global reminders_edited
    with lock:
        for index, reminder in enumerate(reminders):
            if reminder["id"] == reminder_id:
                reminders.pop(index)
                reminders_edited = True
                break
        else:
            return jsonify({"success": False, "message": "Reminder not found."}), 404

    return jsonify({"success": True, "message": "Reminder deleted."})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
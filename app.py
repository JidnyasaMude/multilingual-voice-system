
from flask import Flask, render_template, request, jsonify
from datetime import datetime
from uuid import uuid4

app = Flask(__name__)

reminders = []
last_announcement = None

SUPPORTED_LANGUAGES = ["en", "hi", "mr"]


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def get_status():
    return jsonify({
        "online": True,
        "server": "Mock HTTP Server",
        "rtcOk": False,
        "ttsLanguages": [],
        "speechMode": "simulation_only",
        "lastAnnouncement": last_announcement
    })


@app.route("/api/announce", methods=["POST"])
def announce():
    global last_announcement

    data = request.get_json(silent=True) or {}

    text = str(data.get("text", "")).strip()
    language = data.get("language", "")

    if not text:
        return jsonify({
            "success": False,
            "message": "Please enter announcement text."
        }), 400

    if len(text) > 500:
        return jsonify({
            "success": False,
            "message": "Announcement must be 500 characters or less."
        }), 400

    if language not in SUPPORTED_LANGUAGES:
        return jsonify({
            "success": False,
            "message": "Select a valid language."
        }), 400

    last_announcement = {
        "text": text,
        "language": language,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    return jsonify({
        "success": True,
        "message": "Announcement request received. No real speech was generated.",
        "announcement": last_announcement,
        "simulated": True
    })


@app.route("/api/reminders", methods=["GET"])
def get_reminders():
    search = request.args.get("search", "").strip().lower()

    results = [
        reminder for reminder in reminders
        if search in reminder["medicineName"].lower()
        or search in reminder["language"].lower()
    ]

    return jsonify({
        "success": True,
        "reminders": results
    })


@app.route("/api/reminders", methods=["POST"])
def add_reminder():
    data = request.get_json(silent=True) or {}

    name = str(data.get("medicineName", "")).strip()
    time = str(data.get("time", "")).strip()
    language = data.get("language", "en")
    repeat = data.get("repeat", "daily")

    try:
        datetime.strptime(time, "%H:%M")
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Enter a valid time."
        }), 400

    if not name or len(name) > 100:
        return jsonify({
            "success": False,
            "message": "Medicine name is required (maximum 100 characters)."
        }), 400

    if language not in SUPPORTED_LANGUAGES:
        return jsonify({
            "success": False,
            "message": "Select a valid language."
        }), 400

    if repeat not in ["daily", "once"]:
        return jsonify({
            "success": False,
            "message": "Select a valid repeat option."
        }), 400

    reminder = {
        "id": str(uuid4())[:8],
        "medicineName": name,
        "time": time,
        "language": language,
        "repeat": repeat
    }

    reminders.append(reminder)

    return jsonify({
        "success": True,
        "message": "Reminder saved in mock server memory.",
        "reminder": reminder
    }), 201


@app.route("/api/reminders/<reminder_id>", methods=["PUT"])
def update_reminder(reminder_id):
    data = request.get_json(silent=True) or {}

    for reminder in reminders:
        if reminder["id"] == reminder_id:
            name = str(data.get("medicineName", "")).strip()
            time = str(data.get("time", "")).strip()
            language = data.get("language", "en")
            repeat = data.get("repeat", "daily")

            try:
                datetime.strptime(time, "%H:%M")
            except ValueError:
                return jsonify({
                    "success": False,
                    "message": "Enter a valid time."
                }), 400

            if not name or len(name) > 100:
                return jsonify({
                    "success": False,
                    "message": "Medicine name is required (maximum 100 characters)."
                }), 400

            if language not in SUPPORTED_LANGUAGES:
                return jsonify({
                    "success": False,
                    "message": "Select a valid language."
                }), 400

            if repeat not in ["daily", "once"]:
                return jsonify({
                    "success": False,
                    "message": "Select a valid repeat option."
                }), 400

            reminder.update({
                "medicineName": name,
                "time": time,
                "language": language,
                "repeat": repeat
            })

            return jsonify({
                "success": True,
                "message": "Reminder updated.",
                "reminder": reminder
            })

    return jsonify({
        "success": False,
        "message": "Reminder not found."
    }), 404


@app.route("/api/reminders/<reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    for reminder in reminders:
        if reminder["id"] == reminder_id:
            reminders.remove(reminder)
            return jsonify({
                "success": True,
                "message": "Reminder deleted."
            })

    return jsonify({
        "success": False,
        "message": "Reminder not found."
    }), 404


if __name__ == "__main__":
    app.run(debug=True)
const $ = (id) => document.getElementById(id);

const LANGS = ["en", "hi", "mr"];
let VOICES = [];
let player = null;

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || data.error || "Request failed.");
    }
    return data;
}

function showMessage(id, message, success = true) {
    const element = $(id);
    element.textContent = message;
    element.style.color = success ? "#167344" : "#b42318";
}

function languageName(language) {
    return { en: "English", hi: "Hindi", mr: "Marathi" }[language] || language;
}

function voiceInfo(id) {
    return VOICES.find((v) => v.id === id);
}

// ---------- SYSTEM STATUS ----------

async function loadStatus() {
    try {
        const data = await api("/api/status");

        $("serverStatus").textContent = data.deviceOnline ? "ESP32 online" : "ESP32 offline";
        $("serverType").textContent = data.server;
        $("rtcStatus").textContent = data.deviceOnline
            ? `Online (WiFi ${data.rssi} dBm)`
            : "Offline - check power and WiFi";
        $("ttsStatus").textContent = data.ttsLanguages.length
            ? data.ttsLanguages.map(languageName).join(", ")
            : "Unknown (device offline)";

        $("lastAnnouncement").textContent = data.lastAnnouncement
            ? "Last request: " + data.lastAnnouncement.text +
              " (" + languageName(data.lastAnnouncement.language) + ")"
            : "No announcement yet.";

        $("lastDose").textContent = data.lastDose
            ? `Last dose: ${data.lastDose.medicineName} - ${data.lastDose.status} at ${data.lastDose.time}`
            : "No dose recorded yet.";
    } catch (error) {
        $("serverStatus").textContent = "Server offline";
        showMessage("announcementResult", error.message, false);
    }
}

// ---------- VOICE ANNOUNCEMENT ----------

$("announcementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;

    try {
        const data = await api("/api/announce", {
            method: "POST",
            body: JSON.stringify({
                text: $("announcementText").value,
                language: $("announcementLanguage").value
            })
        });
        showMessage("announcementResult", data.message);
        await loadStatus();
    } catch (error) {
        showMessage("announcementResult", error.message, false);
    } finally {
        button.disabled = false;
    }
});

// ---------- VOICES: dropdown, preview, clip library ----------

async function loadVoices() {
    const data = await api("/api/voices");
    VOICES = data.voices;

    const select = $("reminderVoice");
    const current = select.value;
    select.length = 1;   // keep the text-to-speech option

    ["Time of day", "Meals"].forEach((groupName) => {
        const group = document.createElement("optgroup");
        group.label = groupName;
        VOICES.filter((v) => v.group === groupName).forEach((v) => {
            const option = document.createElement("option");
            option.value = v.id;
            option.textContent = v.label;
            group.appendChild(option);
        });
        select.appendChild(group);
    });
    select.value = current;

    renderClipTable();
    updatePreview();
}

function playClip(key) {
    if (player) player.pause();
    player = new Audio(`/api/clips/${key}?v=${Date.now()}`);
    player.play().catch(() => {});
}

function renderClipTable() {
    const body = $("clipTableBody");
    body.replaceChildren();

    VOICES.forEach((voice) => {
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = voice.label;
        row.appendChild(name);

        LANGS.forEach((lang) => {
            const cell = document.createElement("td");
            const info = voice.clips[lang];
            if (info.present) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "secondary";
                button.textContent = `Play (${Math.round(info.size / 1024)} KB)`;
                button.addEventListener("click", () => playClip(`${voice.id}_${lang}`));
                cell.appendChild(button);
            } else {
                cell.textContent = "Missing";
                cell.className = "clip-missing";
            }
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
}

function updatePreview() {
    const box = $("clipPreview");
    box.replaceChildren();

    const voiceId = $("reminderVoice").value;
    const lang = $("reminderLanguage").value;

    if (!voiceId) {
        box.textContent = "The device will speak the medicine name using text-to-speech.";
        return;
    }
    const voice = voiceInfo(voiceId);
    if (voice && voice.clips[lang].present) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = `/api/clips/${voiceId}_${lang}`;
        box.appendChild(audio);
    } else {
        box.textContent = `No ${voice ? voice.label.toLowerCase() : ""} clip in ${languageName(lang)} - ` +
            "text-to-speech will be used instead.";
        box.style.color = "#b42318";
        return;
    }
    box.style.color = "";
}

$("reminderVoice").addEventListener("change", () => {
    const voice = voiceInfo($("reminderVoice").value);
    if (voice && !$("reminderTime").value) {
        $("reminderTime").value = voice.time;   // suggested time, can be changed
    }
    updatePreview();
});
$("reminderLanguage").addEventListener("change", updatePreview);

// ---------- LOAD, SEARCH AND DISPLAY REMINDERS ----------

async function loadReminders(search = "") {
    try {
        const data = await api("/api/reminders?search=" + encodeURIComponent(search));
        const tbody = $("reminderTableBody");
        tbody.replaceChildren();

        if (data.reminders.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 6;
            cell.textContent = "No reminders found.";
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        data.reminders.forEach((reminder) => {
            const row = document.createElement("tr");

            let voiceText = "Text-to-speech";
            if (reminder.voice) {
                const voice = voiceInfo(reminder.voice);
                const label = voice ? voice.label : reminder.voice;
                voiceText = voice && !voice.clips[reminder.language].present
                    ? `${label} (clip missing - text-to-speech)`
                    : `${label} clip`;
            }

            [
                reminder.medicineName,
                reminder.time,
                languageName(reminder.language),
                reminder.repeat === "daily" ? "Daily" : "Once",
                voiceText
            ].forEach((value) => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });

            const actions = document.createElement("td");
            const group = document.createElement("div");
            group.className = "actions";

            const editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.type = "button";
            editButton.addEventListener("click", () => editReminder(reminder));

            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.type = "button";
            deleteButton.className = "delete-button";
            deleteButton.addEventListener("click", () => deleteReminder(reminder.id));

            group.append(editButton, deleteButton);
            actions.appendChild(group);
            row.appendChild(actions);
            tbody.appendChild(row);
        });
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    }
}

// ---------- SAVE A REMINDER ----------

$("reminderForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = $("reminderId").value;
    const reminder = {
        medicineName: $("medicineName").value.trim(),
        time: $("reminderTime").value,
        language: $("reminderLanguage").value,
        repeat: $("reminderRepeat").value,
        voice: $("reminderVoice").value
    };

    if (!reminder.medicineName && !reminder.voice) {
        showMessage("reminderResult", "Enter a medicine name or choose a voice.", false);
        return;
    }

    const button = $("saveReminderButton");
    button.disabled = true;

    try {
        const url = id ? `/api/reminders/${encodeURIComponent(id)}` : "/api/reminders";
        const data = await api(url, {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(reminder)
        });

        let message = data.message + " The ESP32 syncs automatically within about 15 seconds.";
        const voice = voiceInfo(reminder.voice);
        if (voice && !voice.clips[reminder.language].present) {
            message += ` Note: there is no ${voice.label.toLowerCase()} clip in ` +
                `${languageName(reminder.language)}, so text-to-speech will be used.`;
        }
        showMessage("reminderResult", message);

        resetReminderForm();
        await loadReminders($("reminderSearch").value.trim());
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    } finally {
        button.disabled = false;
    }
});

// ---------- EDIT / RESET / DELETE ----------

function editReminder(reminder) {
    $("reminderId").value = reminder.id;
    $("medicineName").value = reminder.medicineName;
    $("reminderTime").value = reminder.time;
    $("reminderLanguage").value = reminder.language;
    $("reminderRepeat").value = reminder.repeat;
    $("reminderVoice").value = reminder.voice || "";

    $("saveReminderButton").textContent = "Update Reminder";
    $("cancelEditButton").hidden = false;
    updatePreview();
    $("reminderForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetReminderForm() {
    $("reminderForm").reset();
    $("reminderId").value = "";
    $("saveReminderButton").textContent = "Save Reminder";
    $("cancelEditButton").hidden = true;
    updatePreview();
}

$("cancelEditButton").addEventListener("click", resetReminderForm);

async function deleteReminder(id) {
    if (!confirm("Delete this reminder?")) return;

    try {
        const data = await api(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
        showMessage("reminderResult", data.message);
        await loadReminders($("reminderSearch").value.trim());
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    }
}

// ---------- SEARCH ----------

$("searchButton").addEventListener("click", () => {
    loadReminders($("reminderSearch").value.trim());
});

$("clearSearchButton").addEventListener("click", () => {
    $("reminderSearch").value = "";
    loadReminders();
});

$("reminderSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        loadReminders($("reminderSearch").value.trim());
    }
});

// ---------- DEVICE WIFI ----------

$("wifiForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
        const data = await api("/api/wifi", {
            method: "POST",
            body: JSON.stringify({
                ssid: $("wifiSsid").value.trim(),
                password: $("wifiPassword").value
            })
        });
        showMessage("wifiResult", data.message);
        $("wifiForm").reset();
    } catch (error) {
        showMessage("wifiResult", error.message, false);
    } finally {
        button.disabled = false;
    }
});

// ---------- INIT ----------

(async () => {
    try {
        await loadVoices();
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    }
    loadStatus();
    loadReminders();
    setInterval(loadStatus, 10000);
})();
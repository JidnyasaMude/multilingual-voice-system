const $ = (id) => document.getElementById(id);

const SLOTS = ["morning", "afternoon", "evening", "night"];
const MAX_CLIP_BYTES = 300 * 1024;

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
    const languages = {
        en: "English",
        hi: "Hindi",
        mr: "Marathi"
    };

    return languages[language] || language;
}

function slotName(slot) {
    return slot.charAt(0).toUpperCase() + slot.slice(1);
}

// SYSTEM STATUS

async function loadStatus() {
    try {
        const data = await api("/api/status");

        $("serverStatus").textContent = data.deviceOnline
            ? "ESP32 online" : "ESP32 offline";
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

// VOICE ANNOUNCEMENT

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

// DOSE VOICE CLIPS

async function loadClips() {
    try {
        const data = await api("/api/clips");
        const grid = $("clipGrid");
        grid.replaceChildren();

        SLOTS.forEach((slot) => {
            const info = data.clips[slot];

            const card = document.createElement("div");
            card.className = "status-card clip-card";

            const title = document.createElement("strong");
            title.textContent = slotName(slot) + " dose";

            const state = document.createElement("span");
            state.className = "muted";
            state.textContent = info.present
                ? (info.source === "uploaded" ? "Your recording" : "Default recording") +
                  ` (${Math.round(info.size / 1024)} KB)`
                : "No clip - text-to-speech is used";

            card.append(title, state);

            if (info.present) {
                const player = document.createElement("audio");
                player.controls = true;
                player.src = `/api/clips/${slot}?v=${Date.now()}`;
                card.appendChild(player);
            }

            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".mp3,audio/mpeg";

            const row = document.createElement("div");
            row.className = "button-row";

            const uploadButton = document.createElement("button");
            uploadButton.type = "button";
            uploadButton.textContent = "Upload";
            uploadButton.addEventListener("click", () => uploadClip(slot, fileInput));
            row.appendChild(uploadButton);

            if (info.source === "uploaded") {
                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "secondary";
                removeButton.textContent = "Remove";
                removeButton.addEventListener("click", () => removeClip(slot));
                row.appendChild(removeButton);
            }

            card.append(fileInput, row);
            grid.appendChild(card);
        });
    } catch (error) {
        showMessage("clipResult", error.message, false);
    }
}

async function uploadClip(slot, fileInput) {
    const file = fileInput.files[0];

    if (!file) {
        showMessage("clipResult", "Choose an MP3 file first.", false);
        return;
    }
    if (file.size > MAX_CLIP_BYTES) {
        showMessage("clipResult", "File too large (maximum 300 KB).", false);
        return;
    }

    const form = new FormData();
    form.append("file", file);

    try {
        const response = await fetch(`/api/clips/${slot}`, { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.message || "Upload failed.");
        }

        showMessage("clipResult",
            data.message + " The ESP32 downloads it within about 30 seconds.");
        await loadClips();
    } catch (error) {
        showMessage("clipResult", error.message, false);
    }
}

async function removeClip(slot) {
    if (!confirm(`Remove the ${slotName(slot)} clip?`)) {
        return;
    }

    try {
        const data = await api(`/api/clips/${slot}`, { method: "DELETE" });
        showMessage("clipResult", data.message);
        await loadClips();
        await loadReminders($("reminderSearch").value.trim());
    } catch (error) {
        showMessage("clipResult", error.message, false);
    }
}

// LOAD, SEARCH AND DISPLAY REMINDERS

async function loadReminders(search = "") {
    try {
        const data = await api(
            "/api/reminders?search=" + encodeURIComponent(search)
        );

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

            [
                reminder.medicineName,
                reminder.time,
                languageName(reminder.language),
                reminder.repeat === "daily" ? "Daily" : "Once",
                reminder.slot ? slotName(reminder.slot) + " clip" : "Text-to-speech"
            ].forEach((value) => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });

            const actions = document.createElement("td");
            const actionGroup = document.createElement("div");

            actionGroup.className = "actions";

            const editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.type = "button";

            editButton.addEventListener("click", () => {
                editReminder(reminder);
            });

            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.type = "button";
            deleteButton.className = "delete-button";

            deleteButton.addEventListener("click", () => {
                deleteReminder(reminder.id);
            });

            actionGroup.append(editButton, deleteButton);
            actions.appendChild(actionGroup);
            row.appendChild(actions);
            tbody.appendChild(row);
        });
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    }
}

// SAVE A REMINDER TO ESP32 AND THE WEB APP

$("reminderForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = $("reminderId").value;

    const reminder = {
        medicineName: $("medicineName").value.trim(),
        time: $("reminderTime").value,
        language: $("reminderLanguage").value,
        repeat: $("reminderRepeat").value,
        slot: $("reminderSlot").value
    };

    const button = $("saveReminderButton");
    button.disabled = true;

    try {
        const url = id
            ? `/api/reminders/${encodeURIComponent(id)}`
            : "/api/reminders";

        const data = await api(url, {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(reminder)
        });

        let message = data.message + " The ESP32 syncs automatically within about 15 seconds.";

        if (reminder.slot) {
            const clips = await api("/api/clips");
            if (!clips.clips[reminder.slot].present) {
                message += ` Note: there is no ${reminder.slot} clip yet, so text-to-speech will be used.`;
            }
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

// EDIT A REMINDER

function editReminder(reminder) {
    $("reminderId").value = reminder.id;
    $("medicineName").value = reminder.medicineName;
    $("reminderTime").value = reminder.time;
    $("reminderLanguage").value = reminder.language;
    $("reminderRepeat").value = reminder.repeat;
    $("reminderSlot").value = reminder.slot || "";

    $("saveReminderButton").textContent = "Update Reminder";
    $("cancelEditButton").hidden = false;

    $("reminderForm").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// RESET THE REMINDER FORM

function resetReminderForm() {
    $("reminderForm").reset();
    $("reminderId").value = "";
    $("saveReminderButton").textContent = "Save Reminder";
    $("cancelEditButton").hidden = true;
}

$("cancelEditButton").addEventListener("click", resetReminderForm);

// DELETE A REMINDER FROM THE WEB APP LIST

async function deleteReminder(id) {
    if (!confirm("Delete this reminder?")) {
        return;
    }

    try {
        const data = await api(
            `/api/reminders/${encodeURIComponent(id)}`,
            {
                method: "DELETE"
            }
        );

        showMessage("reminderResult", data.message);

        await loadReminders($("reminderSearch").value.trim());
    } catch (error) {
        showMessage("reminderResult", error.message, false);
    }
}

// SEARCH AND CLEAR SEARCH

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

// INITIALIZE THE WEB APP

loadStatus();
loadClips();
loadReminders();
setInterval(loadStatus, 10000);
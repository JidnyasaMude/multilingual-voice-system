
const $ = (id) => document.getElementById(id);

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

            cell.colSpan = 5;
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
                reminder.repeat === "daily" ? "Daily" : "Once"
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
        repeat: $("reminderRepeat").value
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

        showMessage("reminderResult",
            data.message + " The ESP32 syncs automatically within about 15 seconds.");

        resetReminderForm();
        await loadReminders($("reminderSearch").value.trim());
    } catch (error) {
}});

// EDIT A REMINDER

function editReminder(reminder) {
    $("reminderId").value = reminder.id;
    $("medicineName").value = reminder.medicineName;
    $("reminderTime").value = reminder.time;
    $("reminderLanguage").value = reminder.language;
    $("reminderRepeat").value = reminder.repeat;

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
loadReminders();
setInterval(loadStatus, 10000);
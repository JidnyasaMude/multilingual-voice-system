
const $ = (id) => document.getElementById(id);

const ESP32_BASE_URL = "http://localhost:8180";

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

// CONNECT TO ESP32 AND SCHEDULE A REMINDER

async function scheduleReminderOnESP32(reminder) {
    const timeResponse = await fetch(`${ESP32_BASE_URL}/api/time`);

    if (!timeResponse.ok) {
        throw new Error("Could not read time from ESP32.");
    }

    const timeData = await timeResponse.json();

    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
        .exec(timeData.time);

    if (!match) {
        throw new Error("ESP32 returned an invalid date or time.");
    }

    const [, y, mo, d, h, mi, s] = match;

    const now = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s)
    );

    const [targetHour, targetMinute] = reminder.time
        .split(":")
        .map(Number);

    const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        targetHour,
        targetMinute,
        0
    );

    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    const pad = (value) => String(value).padStart(2, "0");

    const datetime =
        `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ` +
        `${pad(target.getHours())}:${pad(target.getMinutes())}:00`;

    const response = await fetch(`${ESP32_BASE_URL}/api/reminder`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            text: reminder.medicineName,
            language: reminder.language,
            datetime: datetime
        })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error || "ESP32 could not save the reminder."
        );
    }

    return datetime;
}

// SYSTEM STATUS

async function loadStatus() {
    try {
        const data = await api("/api/status");

        $("serverStatus").textContent = data.online
            ? "Mock server connected"
            : "Server offline";

        $("serverType").textContent = data.server;

        $("rtcStatus").textContent = data.rtcOk
            ? "Connected"
            : "Not connected (simulation)";

        $("ttsStatus").textContent = data.ttsLanguages.length
            ? data.ttsLanguages.map(languageName).join(", ")
            : "Not connected (simulation)";

        if (data.lastAnnouncement) {
            $("lastAnnouncement").textContent =
                "Last request: " +
                data.lastAnnouncement.text +
                " (" +
                languageName(data.lastAnnouncement.language) +
                ")";
        } else {
            $("lastAnnouncement").textContent = "No announcement yet.";
        }
    } catch (error) {
        $("serverStatus").textContent = "Server offline";
        $("serverType").textContent = "Unavailable";
        $("rtcStatus").textContent = "Not verified";
        $("ttsStatus").textContent = "Not verified";

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
        if (!id) {
            // Send the new reminder to the ESP32 first.
            const scheduledTime = await scheduleReminderOnESP32(reminder);

            // Save it in the Flask web app's reminder list.
            const data = await api("/api/reminders", {
                method: "POST",
                body: JSON.stringify(reminder)
            });

            showMessage(
                "reminderResult",
                `Reminder sent to ESP32 for ${scheduledTime}. ` +
                `${data.message}`
            );
        } else {
            // Editing changes the web app list only.
            const data = await api(
                `/api/reminders/${encodeURIComponent(id)}`,
                {
                    method: "PUT",
                    body: JSON.stringify(reminder)
                }
            );

            showMessage(
                "reminderResult",
                data.message +
                " Note: the ESP32 reminder was not changed."
            );
        }

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

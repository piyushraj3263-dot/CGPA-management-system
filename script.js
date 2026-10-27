"use strict";

// ============================================
// CGPA MANAGEMENT SYSTEM - FRONTEND CONTROLLER
// Institutional Grade Calculation Engine
// ============================================

// Dynamic API Base: Automatically uses current host on Vercel/production or falls back to localhost:3000
const API_BASE = window.location.protocol.startsWith("http") ? "" : "http://localhost:3000";

let currentStudentId = null;
let currentStudentUID = "";
let currentSemester = 4;
let students = [];
let subjects = [];

const $ = (id) => document.getElementById(id);

// Browser Local Storage Fallback
const STORAGE_KEY = "cgpa_system_local_students";
function getLocalStudents() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
        return {};
    }
}
function saveLocalStudents(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn("LocalStorage save exception:", e);
    }
}

async function apiRequest(url, options = {}) {
    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(
            data.error || data.message || `Request status: ${response.status}`
        );
    }

    return data;
}

function showMessage(message) {
    alert(message);
}

function getValue(id) {
    return $(id)?.value?.trim() || "";
}

function setValue(id, value) {
    if ($(id)) $(id).value = value ?? "";
}

function setText(id, value) {
    if ($(id)) $(id).textContent = value ?? "";
}

function getSemester() {
    const semElement = $("semesterSelect") || $("semester");
    const val = Number(semElement?.value || currentSemester);
    return Number.isInteger(val) && val >= 1 && val <= 8 ? val : 1;
}

// --------------------------------------------
// 1. Clear Form / New Student Record
// --------------------------------------------
function clearForm() {
    currentStudentId = null;
    currentStudentUID = "";
    setValue("studentName", "");
    setValue("studentUID", "");
    setValue("studentBranch", "");
    setValue("subjectName", "");
    setValue("credits", "4");
    setValue("gradePoint", "9");

    updateDashboard({ sgpa: 0, cgpa: 0, totalCredits: 0 });
    subjects = [];
    displaySubjects();
    renderAllVisuals({}, 0, 0);

    showMessage("Form cleared. Enter student details and click Save Record.");
}

// --------------------------------------------
// 2. Load all students
// --------------------------------------------
async function loadStudents(search = "") {
    const query = search.trim();
    const url = `/api/students${query ? `?search=${encodeURIComponent(query)}` : ""}`;

    try {
        const data = await apiRequest(url);
        students = Array.isArray(data.students) ? data.students : [];
    } catch (e) {
        students = [];
    }

    const localStore = getLocalStudents();
    Object.values(localStore).forEach(s => {
        const exists = students.some(st => String(st[2] || st.student_uid || "").toLowerCase() === s.uid.toLowerCase());
        if (!exists) {
            students.push([s.id || s.uid, s.name, s.uid, s.branch]);
        }
    });

    renderStudentDirectory();

    if (query) {
        return students.filter(s => 
            String(s[1] || "").toLowerCase().includes(query.toLowerCase()) ||
            String(s[2] || "").toLowerCase().includes(query.toLowerCase())
        );
    }

    return students;
}

// --------------------------------------------
// 3. Search student by name or UID
// --------------------------------------------
async function searchStudent() {
    const searchInput = $("searchUID") || $("studentSearch");
    const query = searchInput?.value?.trim() || "";

    if (!query) {
        showMessage("Enter a Student UID or Name to search.");
        return;
    }

    try {
        const results = await loadStudents(query);

        if (results.length === 0) {
            showMessage(`No record found matching "${query}". You can create this record below and click Save Record.`);
            return;
        }

        const exactMatch = results.find(
            (s) => String(s[2] || s.student_uid || "").toLowerCase() === query.toLowerCase()
        );

        const student = exactMatch || results[0];
        await selectStudent(student);
        showMessage("Student record loaded successfully.");
    } catch (error) {
        showMessage(`Search error: ${error.message}`);
    }
}

// --------------------------------------------
// 4. Select and display student
// --------------------------------------------
async function selectStudent(student) {
    if (!student) return;

    currentStudentId = Number(Array.isArray(student) ? student[0] : (student.student_id || student.studentId)) || (student[2] || student.uid);
    currentStudentUID = String(Array.isArray(student) ? student[2] : (student.student_uid || student.uid || ""));

    setValue("studentName", Array.isArray(student) ? student[1] : student.name);
    setValue("studentUID", currentStudentUID);
    setValue("studentBranch", Array.isArray(student) ? student[3] : student.branch);

    const sem = getSemester();
    await loadSemesterData(currentStudentId, sem);
}

// --------------------------------------------
// 5. Save a new or update existing student
// --------------------------------------------
async function saveStudent() {
    const name = getValue("studentName");
    const uid = getValue("studentUID");
    const branch = getValue("studentBranch");
    const semester = getSemester();

    if (!name || !uid || !branch) {
        showMessage("Name, Student UID, and Department are required fields.");
        return;
    }

    // Persist to local client storage
    const localStore = getLocalStudents();
    if (!localStore[uid]) {
        localStore[uid] = {
            id: uid,
            name,
            uid,
            branch,
            semesters: {}
        };
    } else {
        localStore[uid].name = name;
        localStore[uid].branch = branch;
    }
    saveLocalStudents(localStore);

    currentStudentId = uid;
    currentStudentUID = uid;

    try {
        const payload = {
            name,
            student_uid: uid,
            branch,
            semester
        };

        const result = await apiRequest("/api/students", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (result.studentId) currentStudentId = result.studentId;
        showMessage(result.message || "Student record saved successfully.");
    } catch (error) {
        showMessage(`Student record "${name}" (${uid}) saved successfully.`);
    }

    await loadStudents();
    await loadSemesterData(currentStudentId, semester);
}

// --------------------------------------------
// 6. Load semester data & calculate SGPA/CGPA
// --------------------------------------------
async function loadSemesterData(studentId, semester) {
    if (!studentId && !currentStudentUID) return;

    currentSemester = Number(semester);
    const uid = currentStudentUID || String(studentId);

    const localStore = getLocalStudents();
    const student = localStore[uid] || { semesters: {} };
    const semData = student.semesters?.[currentSemester] || [];
    subjects = semData;
    displaySubjects();

    // Compute semester SGPA
    let semCredits = 0;
    let semPoints = 0;
    semData.forEach(s => {
        semCredits += Number(s.credits || 0);
        semPoints += Number(s.credits || 0) * Number(s.gradePoint || s.grade_point || 0);
    });
    const sgpa = semCredits > 0 ? (semPoints / semCredits) : 0;

    // Compute overall CGPA across all semesters
    let totalCredits = 0;
    let totalPoints = 0;
    const semesterHistory = {};

    Object.entries(student.semesters || {}).forEach(([semNum, courseList]) => {
        let sCred = 0;
        let sPts = 0;
        courseList.forEach(s => {
            const cr = Number(s.credits || 0);
            const pt = Number(s.gradePoint || s.grade_point || 0);
            sCred += cr;
            sPts += (cr * pt);
            totalCredits += cr;
            totalPoints += (cr * pt);
        });
        if (sCred > 0) {
            semesterHistory[semNum] = Number((sPts / sCred).toFixed(2));
        }
    });

    const cgpa = totalCredits > 0 ? (totalPoints / totalCredits) : 0;

    updateDashboard({
        sgpa,
        cgpa,
        totalCredits
    });

    renderAllVisuals(student.semesters || {}, cgpa, totalCredits);

    // Sync from server if available
    if (typeof studentId === "number") {
        try {
            const data = await apiRequest(`/api/student/${studentId}/summary?semester=${currentSemester}`);
            if (data.sgpa !== undefined) {
                updateDashboard(data);
            }
        } catch (e) {
            // Keep local computation
        }
    }
}

// --------------------------------------------
// 7. Update dashboard cards
// --------------------------------------------
function updateDashboard(data) {
    const sgpa = Number(data.sgpa ?? 0);
    const cgpa = Number(data.cgpa ?? 0);
    const credits = Number(data.totalCredits ?? data.total_credits ?? data.credits ?? 0);

    setText("sgpa", sgpa.toFixed(2));
    setText("cgpa", cgpa.toFixed(2));
    setText("totalCredits", String(credits));

    const standingElem = $("academicStanding");
    if (standingElem) {
        if (cgpa >= 8.0) standingElem.textContent = "Standing: Distinction (>= 8.0)";
        else if (cgpa >= 6.75) standingElem.textContent = "Standing: First Class (>= 6.75)";
        else if (cgpa >= 5.5) standingElem.textContent = "Standing: Second Class (>= 5.5)";
        else if (cgpa >= 4.0) standingElem.textContent = "Standing: Pass Class (>= 4.0)";
        else standingElem.textContent = "Standing: Pending Evaluation";
    }

    const progressLabel = $("creditProgressLabel");
    if (progressLabel) {
        progressLabel.textContent = `${credits} / 160 Degree Credits`;
    }

    // Sync converter
    if ($("converterCgpaInput")) {
        $("converterCgpaInput").value = cgpa > 0 ? cgpa.toFixed(2) : "8.50";
        convertCgpaToPercent();
    }
}

// --------------------------------------------
// 8. Visual Analytics Rendering Engine
// --------------------------------------------
function renderAllVisuals(allSemestersData, cgpa, totalCredits) {
    renderSGPAChart(allSemestersData);
    renderCreditBarChart(allSemestersData);
    updateCreditProgress(totalCredits, cgpa);
    renderGradeDistribution(allSemestersData);
    updateRegulationsAudit(cgpa, totalCredits);
}

function renderSGPAChart(semestersData) {
    const svg = $("sgpaSvgChart");
    if (!svg) return;

    // Build array of 8 semester SGPAs
    const semPoints = [];
    for (let sem = 1; sem <= 8; sem++) {
        const courses = semestersData[sem] || [];
        if (courses.length > 0) {
            let sc = 0;
            let sp = 0;
            courses.forEach(c => {
                const cr = Number(c.credits || 0);
                const pt = Number(c.gradePoint || c.grade_point || 0);
                sc += cr;
                sp += cr * pt;
            });
            semPoints.push({
                semester: sem,
                sgpa: sc > 0 ? Number((sp / sc).toFixed(2)) : 0,
                hasData: true
            });
        } else {
            semPoints.push({
                semester: sem,
                sgpa: 0,
                hasData: false
            });
        }
    }

    const hasAnyData = semPoints.some(p => p.hasData);
    if (!hasAnyData) {
        svg.innerHTML = `
            <line x1="50" y1="180" x2="510" y2="180" stroke="#cbd5e1" stroke-width="1" />
            <text x="280" y="105" text-anchor="middle" fill="#94a3b8" font-size="13">No semester history recorded yet.</text>
        `;
        return;
    }

    const xStart = 60;
    const xEnd = 500;
    const yTop = 30;
    const yBottom = 180;
    const xStep = (xEnd - xStart) / 7;

    const getY = (val) => yBottom - ((val / 10) * (yBottom - yTop));
    const getX = (semIndex) => xStart + (semIndex * xStep);

    let html = "";

    // Background horizontal grid lines
    [0, 2, 4, 6, 8, 10].forEach(val => {
        const y = getY(val);
        const isDistinction = val === 8;
        html += `
            <line x1="${xStart}" y1="${y}" x2="${xEnd}" y2="${y}" 
                  stroke="${isDistinction ? '#f59e0b' : '#e2e8f0'}" 
                  stroke-dasharray="${isDistinction ? '4,4' : 'none'}" 
                  stroke-width="${isDistinction ? '1.5' : '1'}" />
            <text x="${xStart - 10}" y="${y + 4}" text-anchor="end" fill="${isDistinction ? '#b45309' : '#64748b'}" font-size="11" font-weight="${isDistinction ? '600' : '400'}">${val}</text>
        `;
    });

    html += `
        <text x="${xEnd - 4}" y="${getY(8) - 6}" text-anchor="end" fill="#b45309" font-size="10" font-weight="600">Distinction Cutoff (8.0)</text>
    `;

    // Connect points
    const validPoints = semPoints.filter(p => p.hasData);
    if (validPoints.length >= 2) {
        const polyCoords = validPoints.map(p => `${getX(p.semester - 1)},${getY(p.sgpa)}`).join(" ");
        html += `
            <polyline fill="none" stroke="#0284c7" stroke-width="3" points="${polyCoords}" />
        `;
    }

    // Draw semester nodes
    semPoints.forEach((p, idx) => {
        const x = getX(idx);
        const isCurrent = p.semester === currentSemester;

        html += `
            <text x="${x}" y="${yBottom + 20}" text-anchor="middle" fill="${isCurrent ? '#0f172a' : '#64748b'}" font-size="12" font-weight="${isCurrent ? '700' : '500'}">Sem ${p.semester}</text>
        `;

        if (p.hasData) {
            const y = getY(p.sgpa);
            html += `
                <circle cx="${x}" cy="${y}" r="${isCurrent ? '6' : '4.5'}" fill="${isCurrent ? '#0f172a' : '#0284c7'}" stroke="#ffffff" stroke-width="2" />
                <rect x="${x - 18}" y="${y - 24}" width="36" height="16" fill="#1e293b" rx="2" />
                <text x="${x}" y="${y - 13}" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="700">${p.sgpa.toFixed(2)}</text>
            `;
        } else {
            html += `
                <circle cx="${x}" cy="${yBottom}" r="3" fill="#cbd5e1" />
            `;
        }
    });

    svg.innerHTML = html;
}

function renderCreditBarChart(semestersData) {
    const svg = $("creditBarChart");
    if (!svg) return;

    const xStart = 50;
    const xEnd = 500;
    const yBottom = 140;
    const yTop = 25;
    const maxCredits = 30;
    const barWidth = 28;
    const xStep = (xEnd - xStart) / 8;

    let hasCredits = false;
    let html = `
        <line x1="${xStart}" y1="${yBottom}" x2="${xEnd}" y2="${yBottom}" stroke="#cbd5e1" stroke-width="1" />
    `;

    for (let sem = 1; sem <= 8; sem++) {
        const courses = semestersData[sem] || [];
        let semCredits = 0;
        courses.forEach(c => { semCredits += Number(c.credits || 0); });

        const xCenter = xStart + (sem - 0.5) * xStep;
        const xBar = xCenter - (barWidth / 2);
        const isCurrent = sem === currentSemester;

        if (semCredits > 0) hasCredits = true;

        const barHeight = Math.min(yBottom - yTop, (semCredits / maxCredits) * (yBottom - yTop));
        const yBar = yBottom - barHeight;

        html += `
            <text x="${xCenter}" y="${yBottom + 18}" text-anchor="middle" fill="${isCurrent ? '#0f172a' : '#64748b'}" font-size="11" font-weight="${isCurrent ? '700' : '500'}">S${sem}</text>
        `;

        if (semCredits > 0) {
            html += `
                <rect x="${xBar}" y="${yBar}" width="${barWidth}" height="${barHeight}" fill="${isCurrent ? '#0f172a' : '#0284c7'}" rx="2" />
                <text x="${xCenter}" y="${yBar - 5}" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="700">${semCredits}</text>
            `;
        }
    }

    if (!hasCredits) {
        svg.innerHTML = `
            <line x1="50" y1="140" x2="510" y2="140" stroke="#cbd5e1" stroke-width="1" />
            <text x="280" y="80" text-anchor="middle" fill="#94a3b8" font-size="12">No registered course credits across semesters.</text>
        `;
        return;
    }

    svg.innerHTML = html;
}

function updateCreditProgress(totalCredits, cgpa) {
    const required = 160;
    const completed = Math.min(required, totalCredits);
    const percent = Math.min(100, Math.round((completed / required) * 100));

    const fillBar = $("creditProgressBar");
    if (fillBar) fillBar.style.width = `${percent}%`;

    setText("creditPercentText", `${percent}% Completed (${totalCredits} credits)`);
    const remaining = Math.max(0, required - totalCredits);
    setText("creditRemainingText", remaining === 0 ? "Degree Requirement Fulfilled" : `${remaining} Credits Remaining`);

    const badge = $("divisionBadge");
    const note = $("divisionNote");
    if (!badge || !note) return;

    badge.className = "division-badge";

    if (totalCredits === 0) {
        badge.textContent = "Pending Evaluation";
        note.textContent = "Register graded semester courses to establish institutional standing.";
    } else if (cgpa >= 8.0) {
        badge.classList.add("division-distinction");
        badge.textContent = "First Class with Distinction";
        note.textContent = "Cumulative Grade Point Average is 8.00 or higher with zero un-cleared courses.";
    } else if (cgpa >= 6.75) {
        badge.classList.add("division-first");
        badge.textContent = "First Class";
        note.textContent = "Cumulative Grade Point Average is between 6.75 and 7.99.";
    } else if (cgpa >= 5.5) {
        badge.classList.add("division-second");
        badge.textContent = "Second Class";
        note.textContent = "Cumulative Grade Point Average is between 5.50 and 6.74.";
    } else if (cgpa >= 4.0) {
        badge.classList.add("division-pass");
        badge.textContent = "Pass Division";
        note.textContent = "Cumulative Grade Point Average meets minimum passing criterion (4.00 to 5.49).";
    } else {
        badge.classList.add("division-pass");
        badge.textContent = "Academic Probation / Unsatisfactory";
        note.textContent = "CGPA is below the minimum graduation threshold of 4.00.";
    }
}

function renderGradeDistribution(semestersData) {
    const bar = $("gradeDistributionBar");
    const legend = $("gradeLegend");
    if (!bar || !legend) return;

    const counts = { "O": 0, "A+": 0, "A": 0, "B+": 0, "B": 0, "C": 0, "P": 0, "F": 0 };
    let totalCourses = 0;

    Object.values(semestersData).forEach(courseList => {
        courseList.forEach(c => {
            const g = (c.grade || "F").toUpperCase();
            if (counts[g] !== undefined) {
                counts[g]++;
                totalCourses++;
            }
        });
    });

    if (totalCourses === 0) {
        bar.innerHTML = `<div class="dist-empty">No course evaluations registered across completed semesters.</div>`;
        legend.innerHTML = "";
        return;
    }

    const colorMap = {
        "O": "#065f46",
        "A+": "#047857",
        "A": "#0284c7",
        "B+": "#2563eb",
        "B": "#475569",
        "C": "#d97706",
        "P": "#64748b",
        "F": "#dc2626"
    };

    let barHtml = "";
    let legendHtml = "";

    Object.entries(counts).forEach(([grade, count]) => {
        if (count > 0) {
            const pct = ((count / totalCourses) * 100).toFixed(1);
            barHtml += `
                <div class="dist-segment" style="width: ${pct}%; background-color: ${colorMap[grade]};" title="${grade}: ${count} courses (${pct}%)">
                    ${pct > 7 ? `${grade} (${count})` : (pct > 4 ? grade : "")}
                </div>
            `;
            legendHtml += `
                <div class="legend-item">
                    <span class="legend-color" style="background-color: ${colorMap[grade]};"></span>
                    <span><strong>${grade}</strong>: ${count} (${pct}%)</span>
                </div>
            `;
        }
    });

    bar.innerHTML = barHtml;
    legend.innerHTML = legendHtml;
}

function updateRegulationsAudit(cgpa, totalCredits) {
    const honorsEl = $("honorsStatus");
    const distinctionEl = $("distinctionStatus");
    const probationEl = $("probationStatus");

    if (honorsEl) {
        if (cgpa >= 7.5 && totalCredits >= 20) {
            honorsEl.className = "regulation-status status-eligible";
            honorsEl.textContent = "Eligible for Honors";
        } else {
            honorsEl.className = "regulation-status status-ineligible";
            honorsEl.textContent = cgpa >= 7.5 ? "Pending Credit Requirement" : "Ineligible (CGPA < 7.50)";
        }
    }

    if (distinctionEl) {
        if (cgpa >= 8.0) {
            distinctionEl.className = "regulation-status status-eligible";
            distinctionEl.textContent = "Qualified for Distinction";
        } else {
            distinctionEl.className = "regulation-status status-ineligible";
            distinctionEl.textContent = "Not Qualified (CGPA < 8.00)";
        }
    }

    if (probationEl) {
        if (cgpa >= 5.0 || totalCredits === 0) {
            probationEl.className = "regulation-status status-eligible";
            probationEl.textContent = "Satisfactory Standing";
        } else {
            probationEl.className = "regulation-status status-ineligible";
            probationEl.textContent = "Under Academic Review";
        }
    }
}

// --------------------------------------------
// 9. Display subject rows in table
// --------------------------------------------
function displaySubjects() {
    const body = $("subjectTableBody");
    if (!body) return;

    if (!subjects || subjects.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="5" class="text-muted text-center">
                    No courses registered for Semester ${currentSemester}.
                </td>
            </tr>
        `;
        return;
    }

    body.innerHTML = subjects.map((sub, idx) => {
        const name = sub.subjectName || sub.subject_name || (Array.isArray(sub) ? sub[1] : "");
        const cr = sub.credits ?? (Array.isArray(sub) ? sub[2] : "");
        const grade = sub.grade || (Array.isArray(sub) ? sub[3] : "");
        const pts = sub.gradePoint ?? sub.grade_point ?? (Array.isArray(sub) ? sub[4] : "");

        let badgeClass = "grade-badge";
        if (grade === "O" || grade === "A+" || grade === "A") badgeClass += " grade-high";
        else if (grade === "F") badgeClass += " grade-fail";

        return `
            <tr>
                <td><strong>${name}</strong></td>
                <td>${cr}</td>
                <td><span class="${badgeClass}">${grade}</span></td>
                <td>${pts}</td>
                <td>
                    <button type="button" class="btn-row-delete" onclick="removeCourse(${idx})">Remove</button>
                </td>
            </tr>
        `;
    }).join("");
}

// --------------------------------------------
// 10. Add & Remove Course
// --------------------------------------------
async function addSubject() {
    const subjectName = getValue("subjectName");
    const credits = Number(getValue("credits"));
    const gradePoint = Number(getValue("gradePoint"));
    const semester = getSemester();

    if (!currentStudentId) {
        const name = getValue("studentName");
        const uid = getValue("studentUID");
        const branch = getValue("studentBranch");

        if (name && uid && branch) {
            await saveStudent();
        } else {
            showMessage("Enter Student Name, UID, and Department first.");
            return;
        }
    }

    if (!subjectName) {
        showMessage("Enter the course title.");
        return;
    }

    if (!Number.isFinite(credits) || credits <= 0 || credits > 10) {
        showMessage("Course credits must be a numeric value between 1 and 10.");
        return;
    }

    if (!Number.isFinite(gradePoint) || gradePoint < 0 || gradePoint > 10) {
        showMessage("Grade point must be a value between 0 and 10.");
        return;
    }

    const grade = gradePoint >= 10 ? "O" :
                  gradePoint >= 9 ? "A+" :
                  gradePoint >= 8 ? "A" :
                  gradePoint >= 7 ? "B+" :
                  gradePoint >= 6 ? "B" :
                  gradePoint >= 5 ? "C" :
                  gradePoint >= 4 ? "P" : "F";

    const uid = currentStudentUID || String(currentStudentId);

    const localStore = getLocalStudents();
    if (!localStore[uid]) {
        localStore[uid] = {
            id: uid,
            name: getValue("studentName") || "Student",
            uid,
            branch: getValue("studentBranch") || "General",
            semesters: {}
        };
    }
    if (!localStore[uid].semesters) localStore[uid].semesters = {};
    if (!localStore[uid].semesters[semester]) localStore[uid].semesters[semester] = [];

    const existingIdx = localStore[uid].semesters[semester].findIndex(
        s => (s.subjectName || "").toLowerCase() === subjectName.toLowerCase()
    );
    const newCourseObj = { subjectName, credits, grade, gradePoint };

    if (existingIdx >= 0) {
        localStore[uid].semesters[semester][existingIdx] = newCourseObj;
    } else {
        localStore[uid].semesters[semester].push(newCourseObj);
    }
    saveLocalStudents(localStore);

    if (typeof currentStudentId === "number") {
        apiRequest("/api/grades", {
            method: "POST",
            body: JSON.stringify({
                studentId: currentStudentId,
                semesterNumber: semester,
                semester,
                subjectName,
                credits,
                gradePoint
            })
        }).catch(() => {});
    }

    setValue("subjectName", "");
    setValue("credits", "4");
    setValue("gradePoint", "9");

    showMessage(`Course "${subjectName}" (Grade: ${grade}, Points: ${gradePoint}) registered for Semester ${semester}.`);

    await loadSemesterData(currentStudentId, semester);
}

function removeCourse(index) {
    const uid = currentStudentUID || String(currentStudentId);
    const localStore = getLocalStudents();
    const sem = getSemester();

    if (localStore[uid]?.semesters?.[sem]) {
        localStore[uid].semesters[sem].splice(index, 1);
        saveLocalStudents(localStore);
        loadSemesterData(currentStudentId, sem);
    }
}

// --------------------------------------------
// 11. Populate Standard Semester Syllabus
// --------------------------------------------
async function populateSemesterCourses() {
    const sem = getSemester();

    const curriculumCSE = {
        1: [
            { subjectName: "Engineering Mathematics I", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Engineering Physics", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Programming in C", credits: 4, grade: "O", gradePoint: 10 },
            { subjectName: "Basic Electrical Systems", credits: 3, grade: "A", gradePoint: 8 },
            { subjectName: "Computing Practice Lab", credits: 2, grade: "O", gradePoint: 10 }
        ],
        2: [
            { subjectName: "Engineering Mathematics II", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Object-Oriented Programming (C++)", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Digital Logic Design", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Engineering Chemistry", credits: 3, grade: "B+", gradePoint: 7 },
            { subjectName: "Data Structures Foundation", credits: 4, grade: "O", gradePoint: 10 }
        ],
        3: [
            { subjectName: "Data Structures & Algorithms", credits: 4, grade: "O", gradePoint: 10 },
            { subjectName: "Computer Architecture", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Discrete Mathematics", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Object-Oriented Java", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "DSA Laboratory", credits: 2, grade: "O", gradePoint: 10 }
        ],
        4: [
            { subjectName: "Database Management Systems", credits: 4, grade: "O", gradePoint: 10 },
            { subjectName: "Operating Systems Principles", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Design and Analysis of Algorithms", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Theory of Computation", credits: 4, grade: "B+", gradePoint: 7 },
            { subjectName: "DBMS Laboratory", credits: 2, grade: "O", gradePoint: 10 }
        ],
        5: [
            { subjectName: "Computer Networks", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Software Engineering Practice", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Compiler Design", credits: 4, grade: "B+", gradePoint: 7 },
            { subjectName: "Web Technologies & REST", credits: 3, grade: "O", gradePoint: 10 },
            { subjectName: "Networks Laboratory", credits: 2, grade: "A+", gradePoint: 9 }
        ],
        6: [
            { subjectName: "Cloud Computing and Virtualization", credits: 4, grade: "A+", gradePoint: 9 },
            { subjectName: "Information & Network Security", credits: 4, grade: "A", gradePoint: 8 },
            { subjectName: "Artificial Intelligence Fundamentals", credits: 4, grade: "O", gradePoint: 10 },
            { subjectName: "Mobile Application Engineering", credits: 3, grade: "A+", gradePoint: 9 },
            { subjectName: "Mini Project Lab", credits: 3, grade: "O", gradePoint: 10 }
        ]
    };

    const courseSet = curriculumCSE[sem] || [
        { subjectName: `Core Course I (Sem ${sem})`, credits: 4, grade: "A+", gradePoint: 9 },
        { subjectName: `Core Course II (Sem ${sem})`, credits: 4, grade: "A", gradePoint: 8 },
        { subjectName: `Department Elective (Sem ${sem})`, credits: 3, grade: "A+", gradePoint: 9 },
        { subjectName: `Technical Lab (Sem ${sem})`, credits: 2, grade: "O", gradePoint: 10 }
    ];

    const uid = currentStudentUID || getValue("studentUID");
    if (!uid) {
        showMessage("Enter or load a student record first.");
        return;
    }

    const localStore = getLocalStudents();
    if (!localStore[uid]) {
        localStore[uid] = {
            id: uid,
            name: getValue("studentName") || "Student",
            uid,
            branch: getValue("studentBranch") || "Computer Science",
            semesters: {}
        };
    }
    if (!localStore[uid].semesters) localStore[uid].semesters = {};
    localStore[uid].semesters[sem] = [...courseSet];
    saveLocalStudents(localStore);

    showMessage(`Populated ${courseSet.length} standard syllabus courses for Semester ${sem}.`);
    await loadSemesterData(currentStudentId || uid, sem);
}

// --------------------------------------------
// 12. Load Realistic Sample Student
// --------------------------------------------
async function loadRandomStudent() {
    const sampleProfiles = [
        {
            name: "Aarav Sharma",
            uid: "22BCS1042",
            branch: "Computer Science and Engineering",
            activeSem: 4,
            semesters: {
                1: [
                    { subjectName: "Engineering Mathematics I", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Engineering Physics", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Programming in C", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Basic Electrical Systems", credits: 3, grade: "A", gradePoint: 8 },
                    { subjectName: "Physics Laboratory", credits: 2, grade: "O", gradePoint: 10 }
                ],
                2: [
                    { subjectName: "Engineering Mathematics II", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "OOP with C++", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Digital Electronics", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Environmental Science", credits: 3, grade: "B+", gradePoint: 7 },
                    { subjectName: "Programming Lab", credits: 2, grade: "O", gradePoint: 10 }
                ],
                3: [
                    { subjectName: "Data Structures & Algorithms", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Computer Architecture", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Discrete Mathematics", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Java Software Design", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "DSA Laboratory", credits: 2, grade: "O", gradePoint: 10 }
                ],
                4: [
                    { subjectName: "Database Management Systems", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Operating Systems", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Algorithms Analysis", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Theory of Computation", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "DBMS Lab Implementation", credits: 2, grade: "O", gradePoint: 10 }
                ]
            }
        },
        {
            name: "Sneha Patel",
            uid: "23BEC1188",
            branch: "Electronics and Communication",
            activeSem: 3,
            semesters: {
                1: [
                    { subjectName: "Applied Calculus", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Solid State Devices", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Circuit Analysis", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Engineering Chemistry", credits: 3, grade: "A", gradePoint: 8 },
                    { subjectName: "Circuits Lab", credits: 2, grade: "O", gradePoint: 10 }
                ],
                2: [
                    { subjectName: "Differential Equations", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Electronic Devices & Circuits", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Signals and Systems", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Basic C Programming", credits: 3, grade: "A+", gradePoint: 9 },
                    { subjectName: "Electronics Lab", credits: 2, grade: "O", gradePoint: 10 }
                ],
                3: [
                    { subjectName: "Analog Communication", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Electromagnetic Fields", credits: 4, grade: "A", gradePoint: 8 },
                    { subjectName: "Microprocessors & Interfacing", credits: 4, grade: "O", gradePoint: 10 },
                    { subjectName: "Digital Signal Processing", credits: 4, grade: "A+", gradePoint: 9 },
                    { subjectName: "Microprocessor Lab", credits: 2, grade: "O", gradePoint: 10 }
                ]
            }
        }
    ];

    const pick = sampleProfiles[Math.floor(Math.random() * sampleProfiles.length)];

    const localStore = getLocalStudents();
    localStore[pick.uid] = {
        id: pick.uid,
        name: pick.name,
        uid: pick.uid,
        branch: pick.branch,
        semesters: pick.semesters
    };
    saveLocalStudents(localStore);

    setValue("studentName", pick.name);
    setValue("studentUID", pick.uid);
    setValue("studentBranch", pick.branch);
    if ($("semesterSelect")) $("semesterSelect").value = String(pick.activeSem);

    currentStudentId = pick.uid;
    currentStudentUID = pick.uid;
    currentSemester = pick.activeSem;

    apiRequest("/api/students", {
        method: "POST",
        body: JSON.stringify({
            name: pick.name,
            student_uid: pick.uid,
            branch: pick.branch,
            semester: pick.activeSem
        })
    }).then(res => {
        if (res.studentId) currentStudentId = res.studentId;
    }).catch(() => {});

    showMessage(`Loaded realistic academic record for ${pick.name} (${pick.uid}) across ${Object.keys(pick.semesters).length} semesters.`);
    await loadSemesterData(currentStudentId, pick.activeSem);
    renderStudentDirectory();
}

// --------------------------------------------
// 13. Enrolled Student Directory Table
// --------------------------------------------
function renderStudentDirectory() {
    const tbody = $("studentDirectoryBody");
    if (!tbody) return;

    const localStore = getLocalStudents();
    const studentList = Object.values(localStore);

    if (studentList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-muted text-center">No enrolled student profiles in repository.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = studentList.map(s => `
        <tr>
            <td><strong>${s.uid}</strong></td>
            <td>${s.name}</td>
            <td>${s.branch}</td>
            <td>
                <button type="button" class="btn-row-load" onclick="loadDirectoryStudent('${s.uid}')">Load Record</button>
            </td>
        </tr>
    `).join("");
}

async function loadDirectoryStudent(uid) {
    const localStore = getLocalStudents();
    const student = localStore[uid];
    if (student) {
        await selectStudent(student);
        window.scrollTo({ top: 0, behavior: "smooth" });
        showMessage(`Loaded record for ${student.name} (${student.uid}).`);
    }
}

// --------------------------------------------
// 14. Official Academic Transcript Modal
// --------------------------------------------
function openTranscriptModal() {
    const uid = currentStudentUID || getValue("studentUID");
    const name = getValue("studentName") || "Student";
    const branch = getValue("studentBranch") || "Engineering";

    const localStore = getLocalStudents();
    const student = localStore[uid] || { semesters: {} };

    setText("transName", name);
    setText("transUID", uid || "PENDING-ENROLLMENT");
    setText("transBranch", branch);

    const standing = $("academicStanding")?.textContent?.replace("Standing: ", "") || "Good Standing";
    setText("transStanding", standing);

    let totalCredits = 0;
    let totalGradePoints = 0;
    let semContainerHtml = "";

    const semesters = student.semesters || {};
    const semKeys = Object.keys(semesters).sort((a, b) => Number(a) - Number(b));

    if (semKeys.length === 0) {
        semContainerHtml = `<p class="text-muted text-center">No completed semester records available for this candidate.</p>`;
    } else {
        semKeys.forEach(semNum => {
            const courseList = semesters[semNum] || [];
            let semCred = 0;
            let semPts = 0;

            const courseRows = courseList.map(c => {
                const cr = Number(c.credits || 0);
                const pt = Number(c.gradePoint || c.grade_point || 0);
                semCred += cr;
                semPts += (cr * pt);
                totalCredits += cr;
                totalGradePoints += (cr * pt);

                return `
                    <tr>
                        <td><strong>${c.subjectName}</strong></td>
                        <td>${cr}</td>
                        <td>${c.grade}</td>
                        <td>${pt}</td>
                    </tr>
                `;
            }).join("");

            const sgpa = semCred > 0 ? (semPts / semCred).toFixed(2) : "0.00";

            semContainerHtml += `
                <div class="trans-sem-block">
                    <div class="trans-sem-title">SEMESTER ${semNum} (Earned Credits: ${semCred} | SGPA: ${sgpa})</div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Course Title</th>
                                <th>Credits</th>
                                <th>Letter Grade</th>
                                <th>Grade Point</th>
                            </tr>
                        </thead>
                        <tbody>${courseRows}</tbody>
                    </table>
                </div>
            `;
        });
    }

    $("transcriptSemestersContainer").innerHTML = semContainerHtml;

    const cgpa = totalCredits > 0 ? (totalGradePoints / totalCredits).toFixed(2) : "0.00";
    const percent = (parseFloat(cgpa) * 9.5).toFixed(2);

    setText("transTotalCredits", String(totalCredits));
    setText("transCGPA", cgpa);
    setText("transPercent", `${percent}%`);

    let division = "Pass";
    const numCgpa = parseFloat(cgpa);
    if (numCgpa >= 8.0) division = "First Class with Distinction";
    else if (numCgpa >= 6.75) division = "First Class";
    else if (numCgpa >= 5.5) division = "Second Class";
    else if (numCgpa >= 4.0) division = "Pass Class";
    else division = "Academic Probation";

    setText("transDivision", division);

    $("transcriptModal").style.display = "flex";
}

function closeTranscriptModal() {
    $("transcriptModal").style.display = "none";
}

// --------------------------------------------
// 15. Institutional CGPA to Percentage Converter
// --------------------------------------------
function convertCgpaToPercent() {
    const cgpaInput = $("converterCgpaInput");
    const resultElem = $("converterResult");
    const classElem = $("converterClassification");
    if (!cgpaInput || !resultElem || !classElem) return;

    let val = parseFloat(cgpaInput.value);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 10) val = 10;

    const percentage = (val * 9.5).toFixed(2);
    resultElem.textContent = `${percentage}%`;

    if (val >= 8.0) {
        classElem.textContent = "First Class with Distinction";
        classElem.style.color = "#065f46";
        classElem.style.backgroundColor = "#ecfdf5";
        classElem.style.borderColor = "#a7f3d0";
    } else if (val >= 6.75) {
        classElem.textContent = "First Class";
        classElem.style.color = "#0369a1";
        classElem.style.backgroundColor = "#f0f9ff";
        classElem.style.borderColor = "#bae6fd";
    } else if (val >= 5.5) {
        classElem.textContent = "Second Class";
        classElem.style.color = "#854d0e";
        classElem.style.backgroundColor = "#fefce8";
        classElem.style.borderColor = "#fef08a";
    } else if (val >= 4.0) {
        classElem.textContent = "Pass Division";
        classElem.style.color = "#334155";
        classElem.style.backgroundColor = "#f8fafc";
        classElem.style.borderColor = "#cbd5e1";
    } else {
        classElem.textContent = "Fail / Remedial Required";
        classElem.style.color = "#991b1b";
        classElem.style.backgroundColor = "#fee2e2";
        classElem.style.borderColor = "#fca5a5";
    }
}

// --------------------------------------------
// 16. Semester Change Handler
// --------------------------------------------
async function handleSemesterChange() {
    const sem = getSemester();
    currentSemester = sem;

    if (currentStudentId || currentStudentUID) {
        await loadSemesterData(currentStudentId || currentStudentUID, sem);
    } else {
        subjects = [];
        displaySubjects();
    }
}

// --------------------------------------------
// 17. Calculate SGPA Button
// --------------------------------------------
async function calculateSGPA() {
    const sem = getSemester();
    await loadSemesterData(currentStudentId || currentStudentUID, sem);

    const sgpaVal = $("sgpa")?.textContent || "0.00";
    const cgpaVal = $("cgpa")?.textContent || "0.00";
    const creditsVal = $("totalCredits")?.textContent || "0";

    showMessage(`Computation Complete:\n\nSemester ${sem} SGPA: ${sgpaVal}\nCumulative CGPA: ${cgpaVal}\nTotal Credits Earned: ${creditsVal}`);
}

// --------------------------------------------
// 18. Initialization
// --------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    const searchBtn = $("searchButton");
    if (searchBtn) searchBtn.addEventListener("click", searchStudent);

    const semSelect = $("semesterSelect") || $("semester");
    if (semSelect) semSelect.addEventListener("change", handleSemesterChange);

    const list = await loadStudents();
    if (list.length > 0) {
        await selectStudent(list[0]);
    } else {
        await loadRandomStudent();
    }

    renderStudentDirectory();
    convertCgpaToPercent();
});

window.searchStudent = searchStudent;
window.saveStudent = saveStudent;
window.addSubject = addSubject;
window.removeCourse = removeCourse;
window.calculateSGPA = calculateSGPA;
window.changeSemester = handleSemesterChange;
window.handleSemesterChange = handleSemesterChange;
window.clearForm = clearForm;
window.populateSemesterCourses = populateSemesterCourses;
window.loadRandomStudent = loadRandomStudent;
window.convertCgpaToPercent = convertCgpaToPercent;
window.openTranscriptModal = openTranscriptModal;
window.closeTranscriptModal = closeTranscriptModal;
window.loadDirectoryStudent = loadDirectoryStudent;

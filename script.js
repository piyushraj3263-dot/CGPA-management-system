"use strict";

// ============================================
// CGPA MANAGEMENT SYSTEM - FRONTEND CONTROLLER
// Institutional Grade Calculation Engine
// ============================================

const API_BASE = "http://localhost:3000";

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

    currentStudentId = Number(Array.isArray(student) ? student[0] : (student.student_id || student.studentId)) || student[2];
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

    let serverLoaded = false;
    if (typeof studentId === "number") {
        try {
            const data = await apiRequest(`/api/student/${studentId}/summary?semester=${currentSemester}`);
            updateDashboard(data);
            await loadSubjectDetails(studentId, currentSemester);
            serverLoaded = true;
        } catch (e) {
            serverLoaded = false;
        }
    }

    if (!serverLoaded) {
        const localStore = getLocalStudents();
        const student = localStore[uid] || { semesters: {} };
        const semData = student.semesters?.[currentSemester] || [];
        subjects = semData;
        displaySubjects();

        let semCredits = 0;
        let semPoints = 0;
        semData.forEach(s => {
            semCredits += Number(s.credits || 0);
            semPoints += Number(s.credits || 0) * Number(s.gradePoint || s.grade_point || 0);
        });
        const sgpa = semCredits > 0 ? (semPoints / semCredits) : 0;

        let totalCredits = 0;
        let totalPoints = 0;
        Object.values(student.semesters || {}).forEach(courseList => {
            courseList.forEach(s => {
                totalCredits += Number(s.credits || 0);
                totalPoints += Number(s.credits || 0) * Number(s.gradePoint || s.grade_point || 0);
            });
        });
        const cgpa = totalCredits > 0 ? (totalPoints / totalCredits) : 0;

        updateDashboard({
            sgpa,
            cgpa,
            totalCredits
        });
    }
}

// --------------------------------------------
// 7. Update dashboard cards
// --------------------------------------------
function updateDashboard(data) {
    const sgpa = Number(data.sgpa ?? 0);
    const cgpa = Number(data.cgpa ?? 0);
    const credits = Number(data.totalCredits ?? data.total_credits ?? data.credits ?? 0);

    const sgpaElements = [ $("sgpa"), $("currentSGPA") ];
    const cgpaElements = [ $("cgpa"), $("overallCGPA") ];
    const creditsElements = [ $("totalCredits"), $("creditsCount") ];

    sgpaElements.forEach(el => { if (el) el.textContent = sgpa.toFixed(2); });
    cgpaElements.forEach(el => { if (el) el.textContent = cgpa.toFixed(2); });
    creditsElements.forEach(el => { if (el) el.textContent = credits; });
}

// --------------------------------------------
// 8. Load subjects and grades
// --------------------------------------------
async function loadSubjectDetails(studentId, semester) {
    if (typeof studentId === "number") {
        try {
            const data = await apiRequest(`/api/student/${studentId}/grades?semester=${semester}`);
            subjects = data.subjects || data.grades || [];
            displaySubjects();
            return;
        } catch (e) {
            // fallback
        }
    }

    const uid = currentStudentUID || String(studentId);
    const localStore = getLocalStudents();
    subjects = localStore[uid]?.semesters?.[semester] || [];
    displaySubjects();
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
                <td colspan="4" class="text-muted text-center">
                    No courses registered for Semester ${currentSemester}.
                </td>
            </tr>
        `;
        return;
    }

    body.innerHTML = subjects.map((sub) => {
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
            </tr>
        `;
    }).join("");
}

// --------------------------------------------
// 10. Add subject and grade
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

// --------------------------------------------
// 11. Semester Change Handler
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
// 12. Calculate SGPA Button
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
// 13. Initialization
// --------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    const searchBtn = $("searchButton");
    if (searchBtn) searchBtn.addEventListener("click", searchStudent);

    const semSelect = $("semesterSelect") || $("semester");
    if (semSelect) semSelect.addEventListener("change", handleSemesterChange);

    const list = await loadStudents();
    if (list.length > 0) {
        await selectStudent(list[0]);
    }
});

window.searchStudent = searchStudent;
window.saveStudent = saveStudent;
window.addSubject = addSubject;
window.calculateSGPA = calculateSGPA;
window.changeSemester = handleSemesterChange;
window.handleSemesterChange = handleSemesterChange;
window.clearForm = clearForm;

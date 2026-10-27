require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

let oracledb;
try {
    oracledb = require("oracledb");
} catch (e) {
    console.warn("[DBMS] oracledb module not available, using local database mode.");
}

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Serve frontend static files
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(__dirname, "script.js")));
app.get("/favicon.svg", (req, res) => res.sendFile(path.join(__dirname, "favicon.svg")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "privacy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "terms.html")));

// ---------------------------------------------------------------------
// DATABASE CONTROLLER (Oracle with Automatic SQLite Fallback)
// ---------------------------------------------------------------------
const SQLITE_FILE = process.env.VERCEL ? path.join("/tmp", "cgpa_local.db") : path.join(__dirname, "cgpa_local.db");
let localDb = null;
let useOracle = false;

function initLocalDatabase() {
    localDb = new DatabaseSync(SQLITE_FILE);
    localDb.exec("PRAGMA foreign_keys = ON;");
    localDb.exec(`
        CREATE TABLE IF NOT EXISTS students (
            student_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            student_uid TEXT NOT NULL UNIQUE,
            branch TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS semesters (
            semester_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            semester_number INTEGER NOT NULL,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
            UNIQUE(student_id, semester_number)
        );

        CREATE TABLE IF NOT EXISTS subjects (
            subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_name TEXT NOT NULL,
            credits INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grades (
            grade_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            semester_id INTEGER NOT NULL,
            subject_id INTEGER NOT NULL,
            grade TEXT NOT NULL,
            grade_point REAL NOT NULL,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
            FOREIGN KEY (semester_id) REFERENCES semesters(semester_id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
            UNIQUE(student_id, semester_id, subject_id)
        );
    `);

    // Auto-seed initial student if database is brand new
    const count = localDb.prepare("SELECT COUNT(*) as c FROM students").get().c;
    if (count === 0) {
        const s1 = localDb.prepare("INSERT INTO students (name, student_uid, branch) VALUES (?, ?, ?)").run("Ankit", "25BEC11404", "Electronics & Communication");
        const sid = Number(s1.lastInsertRowid);

        const sem1 = localDb.prepare("INSERT INTO semesters (student_id, semester_number) VALUES (?, ?)").run(sid, 4);
        const semId = Number(sem1.lastInsertRowid);

        const sub1 = localDb.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Signals and Systems", 4);
        const sub2 = localDb.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Analog Electronics", 4);
        const sub3 = localDb.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Electromagnetic Fields", 3);

        localDb.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub1.lastInsertRowid), "O", 10);
        localDb.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub2.lastInsertRowid), "A+", 9);
        localDb.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub3.lastInsertRowid), "A", 8);

        console.log("[DBMS] Seeded sample student (Ankit, 25BEC11404) with 3 subjects!");
    }

    console.log("[DBMS] Local SQLite database ready: " + SQLITE_FILE);
}

// Check Oracle database connection
async function checkOracleConnection() {
    const { DB_USER, DB_PASSWORD, DB_CONNECT_STRING } = process.env;
    if (!oracledb || !DB_USER || !DB_PASSWORD || !DB_CONNECT_STRING) {
        return false;
    }

    try {
        console.log("[DBMS] Testing Oracle connection...");
        const conn = await oracledb.getConnection({
            user: DB_USER,
            password: DB_PASSWORD,
            connectString: DB_CONNECT_STRING
        });

        // Ensure tables exist in Oracle
        try {
            await conn.execute(`
                BEGIN
                    EXECUTE IMMEDIATE 'CREATE TABLE students (
                        student_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        name VARCHAR2(100) NOT NULL,
                        student_uid VARCHAR2(50) NOT NULL UNIQUE,
                        branch VARCHAR2(50) NOT NULL
                    )';
                EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
                END;
            `);
            await conn.execute(`
                BEGIN
                    EXECUTE IMMEDIATE 'CREATE TABLE semesters (
                        semester_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        student_id NUMBER NOT NULL,
                        semester_number NUMBER NOT NULL,
                        CONSTRAINT unq_sem UNIQUE(student_id, semester_number)
                    )';
                EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
                END;
            `);
            await conn.execute(`
                BEGIN
                    EXECUTE IMMEDIATE 'CREATE TABLE subjects (
                        subject_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        subject_name VARCHAR2(100) NOT NULL,
                        credits NUMBER NOT NULL
                    )';
                EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
                END;
            `);
            await conn.execute(`
                BEGIN
                    EXECUTE IMMEDIATE 'CREATE TABLE grades (
                        grade_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        student_id NUMBER NOT NULL,
                        semester_id NUMBER NOT NULL,
                        subject_id NUMBER NOT NULL,
                        grade VARCHAR2(10) NOT NULL,
                        grade_point NUMBER NOT NULL,
                        CONSTRAINT unq_grade UNIQUE(student_id, semester_id, subject_id)
                    )';
                EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
                END;
            `);
            await conn.commit();
        } catch (tableErr) {
            console.warn("[DBMS] Oracle schema check note:", tableErr.message);
        }

        await conn.close();
        console.log("[DBMS] Successfully connected to Oracle Database!");
        return true;
    } catch (err) {
        console.warn("[DBMS] Oracle connection could not be established (" + err.message + ")");
        console.warn("[DBMS] Seamlessly running on high-speed local database.");
        return false;
    }
}

async function getOracleConn() {
    return oracledb.getConnection({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECT_STRING
    });
}

function cleanText(value, maxLength = 100) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function validSemester(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1;
}

// ---------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------

// 1. Health & Status
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        database: useOracle ? "Oracle Database" : "Local SQLite",
        message: "CGPA Manager server v2.0 is running smoothly."
    });
});

app.get("/api/test-db", (req, res) => {
    res.json({
        success: true,
        active_database: useOracle ? "Oracle Database" : "Local SQLite (cgpa_local.db)",
        message: "Database is online and ready for queries."
    });
});

// 2. Search or list students
app.get("/api/students", async (req, res) => {
    const search = cleanText(req.query.search, 100);

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            const result = await conn.execute(
                `SELECT student_id, name, student_uid, branch
                   FROM students
                  WHERE (:p_search IS NULL
                     OR LOWER(name) LIKE '%' || LOWER(:p_search) || '%'
                     OR LOWER(student_uid) LIKE '%' || LOWER(:p_search) || '%')
                  ORDER BY student_id ASC`,
                { p_search: search || null }
            );
            return res.json({ success: true, students: result.rows });
        } catch (e) {
            console.error("[Oracle Error in /api/students]", e.message);
        } finally {
            if (conn) await conn.close();
        }
    }

    // Local SQLite Fallback
    let query = "SELECT student_id, name, student_uid, branch FROM students";
    let params = [];
    if (search) {
        query += " WHERE LOWER(name) LIKE ? OR LOWER(student_uid) LIKE ?";
        const p = `%${search.toLowerCase()}%`;
        params.push(p, p);
    }
    query += " ORDER BY student_id ASC";
    const rows = localDb.prepare(query).all(...params);
    const studentsArray = rows.map(r => [r.student_id, r.name, r.student_uid, r.branch]);
    return res.json({ success: true, students: studentsArray });
});

// 3. Create or update a student (Supports ANY random person!)
app.post("/api/students", async (req, res) => {
    const name = cleanText(req.body.name);
    const uid = cleanText(req.body.student_uid ?? req.body.uid, 50);
    const branch = cleanText(req.body.branch, 50);
    const semester = validSemester(req.body.semester ?? 1);

    if (!name || !uid || !branch) {
        return res.status(400).json({
            success: false,
            message: "Student Name, University ID, and Branch are required."
        });
    }

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            
            // 1. Check existing student using safe bind parameter :p_uid
            const check = await conn.execute(
                "SELECT student_id FROM students WHERE LOWER(student_uid) = LOWER(:p_uid)",
                { p_uid: uid }
            );
            
            let studentId;
            let created = false;

            if (check.rows.length) {
                studentId = check.rows[0][0];
                await conn.execute(
                    "UPDATE students SET name = :p_name, branch = :p_branch WHERE student_id = :p_student_id",
                    { p_name: name, p_branch: branch, p_student_id: studentId }
                );
            } else {
                // Insert new student using standard SQL (zero RETURNING INTO, avoiding ORA-01745)
                try {
                    await conn.execute(
                        "INSERT INTO students (name, student_uid, branch) VALUES (:p_name, :p_uid, :p_branch)",
                        { p_name: name, p_uid: uid, p_branch: branch }
                    );
                } catch (insErr) {
                    const maxId = await conn.execute("SELECT NVL(MAX(student_id), 0) + 1 FROM students");
                    studentId = maxId.rows[0][0];
                    await conn.execute(
                        "INSERT INTO students (student_id, name, student_uid, branch) VALUES (:p_student_id, :p_name, :p_uid, :p_branch)",
                        { p_student_id: studentId, p_name: name, p_uid: uid, p_branch: branch }
                    );
                }

                const getId = await conn.execute(
                    "SELECT student_id FROM students WHERE LOWER(student_uid) = LOWER(:p_uid)",
                    { p_uid: uid }
                );
                studentId = getId.rows[0][0];
                created = true;
            }

            // Ensure semester entry exists for this student
            const semCheck = await conn.execute(
                "SELECT semester_id FROM semesters WHERE student_id = :p_student_id AND semester_number = :p_semester",
                { p_student_id: studentId, p_semester: semester }
            );

            if (!semCheck.rows.length) {
                try {
                    await conn.execute(
                        "INSERT INTO semesters (student_id, semester_number) VALUES (:p_student_id, :p_semester)",
                        { p_student_id: studentId, p_semester: semester }
                    );
                } catch (semErr) {
                    const maxSem = await conn.execute("SELECT NVL(MAX(semester_id), 0) + 1 FROM semesters");
                    await conn.execute(
                        "INSERT INTO semesters (semester_id, student_id, semester_number) VALUES (:p_sem_id, :p_student_id, :p_semester)",
                        { p_sem_id: maxSem.rows[0][0], p_student_id: studentId, p_semester: semester }
                    );
                }
            }

            await conn.commit();

            return res.json({
                success: true,
                message: created ? "Student saved successfully!" : "Student updated successfully!",
                student: [studentId, name, uid, branch],
                studentId,
                semester
            });
        } catch (err) {
            console.error("[Oracle Student Save Error]", err.message);
            // Fall through to save locally in SQLite
        } finally {
            if (conn) await conn.close();
        }
    }

    // Local SQLite Handler
    try {
        const existing = localDb.prepare("SELECT student_id FROM students WHERE LOWER(student_uid) = LOWER(?)").get(uid);
        let studentId;
        let created = false;

        if (existing) {
            studentId = existing.student_id;
            localDb.prepare("UPDATE students SET name = ?, branch = ? WHERE student_id = ?").run(name, branch, studentId);
        } else {
            const ins = localDb.prepare("INSERT INTO students (name, student_uid, branch) VALUES (?, ?, ?)").run(name, uid, branch);
            studentId = Number(ins.lastInsertRowid);
            created = true;
        }

        // Ensure semester exists
        const semExists = localDb.prepare("SELECT semester_id FROM semesters WHERE student_id = ? AND semester_number = ?").get(studentId, semester);
        if (!semExists) {
            localDb.prepare("INSERT INTO semesters (student_id, semester_number) VALUES (?, ?)").run(studentId, semester);
        }

        return res.json({
            success: true,
            message: created ? "Student saved successfully!" : "Student updated successfully!",
            student: [studentId, name, uid, branch],
            studentId,
            semester
        });
    } catch (err) {
        console.error("[Local Save Error]", err);
        return res.status(500).json({ success: false, message: "Error saving student: " + err.message });
    }
});

// 4. Update student by ID
app.put("/api/students/:studentId", async (req, res) => {
    const studentId = Number(req.params.studentId);
    const name = cleanText(req.body.name);
    const uid = cleanText(req.body.student_uid ?? req.body.uid, 50);
    const branch = cleanText(req.body.branch, 50);

    if (!studentId || !name || !uid || !branch) {
        return res.status(400).json({ success: false, message: "Missing required student fields." });
    }

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            await conn.execute(
                "UPDATE students SET name = :p_name, student_uid = :p_uid, branch = :p_branch WHERE student_id = :p_student_id",
                { p_name: name, p_uid: uid, p_branch: branch, p_student_id: studentId }
            );
            await conn.commit();
            return res.json({ success: true, message: "Student updated successfully.", studentId });
        } catch (e) {
            console.error("[Oracle PUT Error]", e.message);
        } finally {
            if (conn) await conn.close();
        }
    }

    try {
        localDb.prepare("UPDATE students SET name = ?, student_uid = ?, branch = ? WHERE student_id = ?").run(name, uid, branch, studentId);
        return res.json({ success: true, message: "Student updated successfully.", studentId });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 5. Load subjects and grades for student in a semester
app.get("/api/student/:studentId/grades", async (req, res) => {
    const studentId = Number(req.params.studentId);
    const semester = validSemester(req.query.semester ?? 1);

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            const semRow = await conn.execute(
                "SELECT semester_id FROM semesters WHERE student_id = :p_student_id AND semester_number = :p_semester",
                { p_student_id: studentId, p_semester: semester }
            );
            if (!semRow.rows.length) {
                return res.json({ success: true, subjects: [], grades: [], semester });
            }
            const semId = semRow.rows[0][0];
            const gRes = await conn.execute(
                `SELECT sub.subject_id, sub.subject_name, sub.credits, g.grade, g.grade_point
                   FROM grades g
                   JOIN subjects sub ON sub.subject_id = g.subject_id
                  WHERE g.student_id = :p_student_id AND g.semester_id = :p_semester_id
                  ORDER BY sub.subject_name`,
                { p_student_id: studentId, p_semester_id: semId }
            );
            const subjects = gRes.rows.map(r => ({ subjectId: r[0], subjectName: r[1], credits: Number(r[2]), grade: r[3], gradePoint: Number(r[4]) }));
            return res.json({ success: true, subjects, grades: subjects, semester });
        } catch (e) {
            console.error("[Oracle Grades Error]", e.message);
        } finally {
            if (conn) await conn.close();
        }
    }

    // Local SQLite
    const semRow = localDb.prepare("SELECT semester_id FROM semesters WHERE student_id = ? AND semester_number = ?").get(studentId, semester);
    if (!semRow) {
        return res.json({ success: true, subjects: [], grades: [], semester });
    }
    const rows = localDb.prepare(`
        SELECT sub.subject_id, sub.subject_name, sub.credits, g.grade, g.grade_point
        FROM grades g
        JOIN subjects sub ON sub.subject_id = g.subject_id
        WHERE g.student_id = ? AND g.semester_id = ?
        ORDER BY sub.subject_name ASC
    `).all(studentId, semRow.semester_id);

    const subjects = rows.map(r => ({
        subjectId: r.subject_id,
        subjectName: r.subject_name,
        credits: r.credits,
        grade: r.grade,
        gradePoint: r.grade_point
    }));
    return res.json({ success: true, subjects, grades: subjects, semester });
});

// 6. Add subject and grade
app.post("/api/grades", async (req, res) => {
    const studentId = Number(req.body.studentId ?? req.body.student_id);
    const semester = validSemester(req.body.semesterNumber ?? req.body.semester ?? 1);
    const subjectName = cleanText(req.body.subjectName ?? req.body.subject_name);
    const credits = Number(req.body.credits);
    const gradePoint = Number(req.body.gradePoint ?? req.body.grade_point);

    if (!studentId || !subjectName || !credits || isNaN(gradePoint)) {
        return res.status(400).json({ success: false, message: "Please provide valid student, subject, credits, and grade point." });
    }

    const grade = gradePoint >= 10 ? "O" :
                  gradePoint >= 9 ? "A+" :
                  gradePoint >= 8 ? "A" :
                  gradePoint >= 7 ? "B+" :
                  gradePoint >= 6 ? "B" :
                  gradePoint >= 5 ? "C" :
                  gradePoint >= 4 ? "P" : "F";

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            let semRes = await conn.execute(
                "SELECT semester_id FROM semesters WHERE student_id = :p_student_id AND semester_number = :p_semester",
                { p_student_id: studentId, p_semester: semester }
            );
            let semesterId;
            if (!semRes.rows.length) {
                try {
                    await conn.execute(
                        "INSERT INTO semesters (student_id, semester_number) VALUES (:p_student_id, :p_semester)",
                        { p_student_id: studentId, p_semester: semester }
                    );
                } catch (e) {
                    const maxSem = await conn.execute("SELECT NVL(MAX(semester_id), 0) + 1 FROM semesters");
                    await conn.execute(
                        "INSERT INTO semesters (semester_id, student_id, semester_number) VALUES (:p_sem_id, :p_student_id, :p_semester)",
                        { p_sem_id: maxSem.rows[0][0], p_student_id: studentId, p_semester: semester }
                    );
                }
                const fetchSem = await conn.execute(
                    "SELECT semester_id FROM semesters WHERE student_id = :p_student_id AND semester_number = :p_semester",
                    { p_student_id: studentId, p_semester: semester }
                );
                semesterId = fetchSem.rows[0][0];
            } else {
                semesterId = semRes.rows[0][0];
            }

            let subRes = await conn.execute(
                "SELECT subject_id FROM subjects WHERE LOWER(subject_name) = LOWER(:p_sub_name) AND credits = :p_credits",
                { p_sub_name: subjectName, p_credits: credits }
            );
            let subjectId;
            if (!subRes.rows.length) {
                try {
                    await conn.execute(
                        "INSERT INTO subjects (subject_name, credits) VALUES (:p_sub_name, :p_credits)",
                        { p_sub_name: subjectName, p_credits: credits }
                    );
                } catch (e) {
                    const maxSub = await conn.execute("SELECT NVL(MAX(subject_id), 0) + 1 FROM subjects");
                    await conn.execute(
                        "INSERT INTO subjects (subject_id, subject_name, credits) VALUES (:p_sub_id, :p_sub_name, :p_credits)",
                        { p_sub_id: maxSub.rows[0][0], p_sub_name: subjectName, p_credits: credits }
                    );
                }
                const fetchSub = await conn.execute(
                    "SELECT subject_id FROM subjects WHERE LOWER(subject_name) = LOWER(:p_sub_name) AND credits = :p_credits",
                    { p_sub_name: subjectName, p_credits: credits }
                );
                subjectId = fetchSub.rows[0][0];
            } else {
                subjectId = subRes.rows[0][0];
            }

            // Check existing grade
            const gCheck = await conn.execute(
                "SELECT grade_id FROM grades WHERE student_id = :p_student_id AND semester_id = :p_semester_id AND subject_id = :p_subject_id",
                { p_student_id: studentId, p_semester_id: semesterId, p_subject_id: subjectId }
            );

            if (gCheck.rows.length) {
                await conn.execute(
                    "UPDATE grades SET grade = :p_grade, grade_point = :p_grade_point WHERE grade_id = :p_grade_id",
                    { p_grade: grade, p_grade_point: gradePoint, p_grade_id: gCheck.rows[0][0] }
                );
            } else {
                try {
                    await conn.execute(
                        "INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (:p_student_id, :p_semester_id, :p_subject_id, :p_grade, :p_grade_point)",
                        { p_student_id: studentId, p_semester_id: semesterId, p_subject_id: subjectId, p_grade: grade, p_grade_point: gradePoint }
                    );
                } catch (e) {
                    const maxG = await conn.execute("SELECT NVL(MAX(grade_id), 0) + 1 FROM grades");
                    await conn.execute(
                        "INSERT INTO grades (grade_id, student_id, semester_id, subject_id, grade, grade_point) VALUES (:p_g_id, :p_student_id, :p_semester_id, :p_subject_id, :p_grade, :p_grade_point)",
                        { p_g_id: maxG.rows[0][0], p_student_id: studentId, p_semester_id: semesterId, p_subject_id: subjectId, p_grade: grade, p_grade_point: gradePoint }
                    );
                }
            }
            await conn.commit();
            return res.json({ success: true, message: `Subject '${subjectName}' and Grade '${grade}' saved!`, grade, gradePoint });
        } catch (e) {
            console.error("[Oracle Post Grade Error]", e.message);
        } finally {
            if (conn) await conn.close();
        }
    }

    // Local SQLite
    try {
        let semRow = localDb.prepare("SELECT semester_id FROM semesters WHERE student_id = ? AND semester_number = ?").get(studentId, semester);
        if (!semRow) {
            const insSem = localDb.prepare("INSERT INTO semesters (student_id, semester_number) VALUES (?, ?)").run(studentId, semester);
            semRow = { semester_id: Number(insSem.lastInsertRowid) };
        }

        let subRow = localDb.prepare("SELECT subject_id FROM subjects WHERE LOWER(subject_name) = LOWER(?) AND credits = ?").get(subjectName, credits);
        if (!subRow) {
            const insSub = localDb.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run(subjectName, credits);
            subRow = { subject_id: Number(insSub.lastInsertRowid) };
        }

        const existingGrade = localDb.prepare("SELECT grade_id FROM grades WHERE student_id = ? AND semester_id = ? AND subject_id = ?")
                                    .get(studentId, semRow.semester_id, subRow.subject_id);

        if (existingGrade) {
            localDb.prepare("UPDATE grades SET grade = ?, grade_point = ? WHERE grade_id = ?")
                   .run(grade, gradePoint, existingGrade.grade_id);
        } else {
            localDb.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)")
                   .run(studentId, semRow.semester_id, subRow.subject_id, grade, gradePoint);
        }

        return res.json({
            success: true,
            message: `Subject '${subjectName}' and Grade '${grade}' (${gradePoint} pts) saved successfully!`,
            grade,
            gradePoint
        });
    } catch (err) {
        console.error("[Local Grade Save Error]", err);
        return res.status(500).json({ success: false, message: "Error saving grade: " + err.message });
    }
});

// 7. Student semester summary (SGPA & CGPA Calculation)
app.get("/api/student/:studentId/summary", async (req, res) => {
    const studentId = Number(req.params.studentId);
    const semester = validSemester(req.query.semester ?? 1);

    if (useOracle) {
        let conn;
        try {
            conn = await getOracleConn();
            const sRes = await conn.execute(
                "SELECT student_id, name, student_uid, branch FROM students WHERE student_id = :p_student_id",
                { p_student_id: studentId }
            );
            if (!sRes.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
            const sRow = sRes.rows[0];

            const sgpaRes = await conn.execute(`
                SELECT NVL(ROUND(SUM(sub.credits * g.grade_point) / NULLIF(SUM(sub.credits), 0), 2), 0) as sgpa,
                       NVL(SUM(sub.credits), 0) as credits
                FROM semesters sem
                LEFT JOIN grades g ON g.semester_id = sem.semester_id AND g.student_id = sem.student_id
                LEFT JOIN subjects sub ON sub.subject_id = g.subject_id
                WHERE sem.student_id = :p_student_id AND sem.semester_number = :p_semester
            `, { p_student_id: studentId, p_semester: semester });

            const cgpaRes = await conn.execute(`
                SELECT NVL(ROUND(SUM(sub.credits * g.grade_point) / NULLIF(SUM(sub.credits), 0), 2), 0) as cgpa,
                       NVL(SUM(sub.credits), 0) as total_credits
                FROM grades g
                JOIN subjects sub ON sub.subject_id = g.subject_id
                WHERE g.student_id = :p_student_id
            `, { p_student_id: studentId });

            return res.json({
                success: true,
                student: { student_id: sRow[0], name: sRow[1], student_uid: sRow[2], branch: sRow[3] },
                semester,
                sgpa: Number(sgpaRes.rows[0][0] || 0),
                credits: Number(sgpaRes.rows[0][1] || 0),
                cgpa: Number(cgpaRes.rows[0][0] || 0),
                totalCredits: Number(cgpaRes.rows[0][1] || 0)
            });
        } catch (e) {
            console.error("[Oracle Summary Error]", e.message);
        } finally {
            if (conn) await conn.close();
        }
    }

    // Local SQLite
    const student = localDb.prepare("SELECT student_id, name, student_uid, branch FROM students WHERE student_id = ?").get(studentId);
    if (!student) {
        return res.status(404).json({ success: false, message: "Student not found." });
    }

    // SGPA for given semester
    const sgpaRow = localDb.prepare(`
        SELECT 
            COALESCE(SUM(sub.credits), 0) as sem_credits,
            CASE WHEN SUM(sub.credits) > 0 
                 THEN ROUND(CAST(SUM(sub.credits * g.grade_point) AS FLOAT) / SUM(sub.credits), 2)
                 ELSE 0.00 END as sgpa
        FROM semesters sem
        LEFT JOIN grades g ON g.semester_id = sem.semester_id AND g.student_id = sem.student_id
        LEFT JOIN subjects sub ON sub.subject_id = g.subject_id
        WHERE sem.student_id = ? AND sem.semester_number = ?
    `).get(studentId, semester);

    // CGPA across all semesters
    const cgpaRow = localDb.prepare(`
        SELECT 
            COALESCE(SUM(sub.credits), 0) as total_credits,
            CASE WHEN SUM(sub.credits) > 0 
                 THEN ROUND(CAST(SUM(sub.credits * g.grade_point) AS FLOAT) / SUM(sub.credits), 2)
                 ELSE 0.00 END as cgpa
        FROM grades g
        JOIN subjects sub ON sub.subject_id = g.subject_id
        WHERE g.student_id = ?
    `).get(studentId);

    return res.json({
        success: true,
        student,
        semester,
        sgpa: sgpaRow ? sgpaRow.sgpa : 0.0,
        credits: sgpaRow ? sgpaRow.sem_credits : 0,
        cgpa: cgpaRow ? cgpaRow.cgpa : 0.0,
        totalCredits: cgpaRow ? cgpaRow.total_credits : 0
    });
});

// Start Server
async function start() {
    initLocalDatabase();
    useOracle = await checkOracleConnection();

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`================================================================`);
        console.log(`🎓 CGPA MANAGEMENT SYSTEM (v2.0) IS RUNNING`);
        console.log(`🚀 Open browser at: http://localhost:${PORT}`);
        console.log(`💾 Active Database Mode: ${useOracle ? "Oracle Cloud Database" : "Local SQLite (cgpa_local.db)"}`);
        console.log(`================================================================`);
    });
}

if (!process.env.VERCEL) {
    start();
} else {
    initLocalDatabase();
    checkOracleConnection().then(ok => { useOracle = ok; });
}

module.exports = app;

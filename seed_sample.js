const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = path.join(__dirname, "cgpa_local.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");

// Ensure tables exist
db.exec(`
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

// Add initial student if none exists
const count = db.prepare("SELECT COUNT(*) as c FROM students").get().c;
if (count === 0) {
    const s1 = db.prepare("INSERT INTO students (name, student_uid, branch) VALUES (?, ?, ?)").run("Aarav Sharma", "21CS101", "Computer Science");
    const sid = Number(s1.lastInsertRowid);

    const sem1 = db.prepare("INSERT INTO semesters (student_id, semester_number) VALUES (?, ?)").run(sid, 1);
    const semId = Number(sem1.lastInsertRowid);

    const sub1 = db.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Database Management Systems", 4);
    const sub2 = db.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Data Structures & Algorithms", 4);
    const sub3 = db.prepare("INSERT INTO subjects (subject_name, credits) VALUES (?, ?)").run("Computer Networks", 3);

    db.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub1.lastInsertRowid), "O", 10);
    db.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub2.lastInsertRowid), "A+", 9);
    db.prepare("INSERT INTO grades (student_id, semester_id, subject_id, grade, grade_point) VALUES (?, ?, ?, ?, ?)").run(sid, semId, Number(sub3.lastInsertRowid), "A", 8);

    console.log("Seeded initial student Aarav Sharma with 3 subjects!");
}

const express = require("express");
const cors = require("cors");
const oracledb = require("oracledb");
const path = require("path");

require("dotenv").config();

const app = express();

// ===============================
// MIDDLEWARE
// ===============================

app.use(cors());
app.use(express.json());

// ===============================
// PORT
// ===============================

const PORT = process.env.PORT || 3000;

// ===============================
// DATABASE CONNECTION
// ===============================

async function getConnection() {
    return await oracledb.getConnection({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECT_STRING
    });
}

// ===============================
// HOME ROUTE
// ===============================

app.get("/", (req, res) => {
    res.send("CGPA Management System Backend is running!");
});

// ===============================
// TEST DATABASE CONNECTION
// ===============================

app.get("/api/test-db", async (req, res) => {
    let connection;

    try {
        connection = await getConnection();

        const result = await connection.execute("SELECT 1 FROM dual");

        res.json({
            success: true,
            message: "Database connected successfully",
            result: result.rows
        });

    } catch (error) {
        console.error("Database connection error:", error);

        res.status(500).json({
            success: false,
            message: "Database connection failed",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// GET STUDENTS
// SEARCH BY NAME OR UID
// ===============================

app.get("/api/students", async (req, res) => {
    let connection;

    try {
        const search = req.query.search || "";

        connection = await getConnection();

        const result = await connection.execute(
            `
            SELECT
                student_id,
                name,
                student_uid,
                branch
            FROM students
            WHERE LOWER(name) LIKE '%' || LOWER(:search) || '%'
               OR LOWER(student_uid) LIKE '%' || LOWER(:search) || '%'
            ORDER BY student_id
            `,
            {
                search
            }
        );

        res.json({
            success: true,
            students: result.rows
        });

    } catch (error) {
        console.error("Error loading students:", error);

        res.status(500).json({
            success: false,
            message: "Failed to load students",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// SAVE / UPDATE STUDENT
// ===============================

app.post("/api/students", async (req, res) => {
    let connection;

    try {
        const {
            name,
            student_uid,
            branch
        } = req.body;

        if (!name || !student_uid || !branch) {
            return res.status(400).json({
                success: false,
                message: "Name, UID and branch are required"
            });
        }

        connection = await getConnection();

        // Check whether student already exists
        const existing = await connection.execute(
            `
            SELECT student_id
            FROM students
            WHERE student_uid = :student_uid
            `,
            {
                student_uid
            }
        );

        // If student already exists → update
        if (existing.rows.length > 0) {

            await connection.execute(
                `
                UPDATE students
                SET name = :name,
                    branch = :branch
                WHERE student_uid = :student_uid
                `,
                {
                    name,
                    branch,
                    student_uid
                }
            );

            await connection.commit();

            return res.json({
                success: true,
                message: "Student updated successfully"
            });
        }

        // Otherwise → create new student
        const result = await connection.execute(
            `
            INSERT INTO students
                (name, student_uid, branch)
            VALUES
                (:name, :student_uid, :branch)
            RETURNING student_id INTO :student_id
            `,
            {
                name,
                student_uid,
                branch,
                student_id: {
                    dir: oracledb.BIND_OUT,
                    type: oracledb.NUMBER
                }
            }
        );

        await connection.commit();

        res.json({
            success: true,
            message: "Student saved successfully",
            student_id: result.outBinds.student_id[0]
        });

    } catch (error) {
        console.error("Error saving student:", error);

        if (connection) {
            await connection.rollback();
        }

        res.status(500).json({
            success: false,
            message: "Failed to save student",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// SAVE SUBJECT + GRADE
// ===============================

app.post("/api/grades", async (req, res) => {
    let connection;

    try {
        const {
            studentId,
            semesterId,
            subjectName,
            credits,
            gradePoint
        } = req.body;

        if (
            !studentId ||
            !semesterId ||
            !subjectName ||
            !credits ||
            gradePoint === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "All subject details are required."
            });
        }

        if (Number(credits) <= 0) {
            return res.status(400).json({
                success: false,
                message: "Credits must be greater than 0."
            });
        }

        if (Number(gradePoint) < 0 || Number(gradePoint) > 10) {
            return res.status(400).json({
                success: false,
                message: "Grade point must be between 0 and 10."
            });
        }

        connection = await getConnection();

        // Check student
        const studentCheck = await connection.execute(
            `
            SELECT student_id
            FROM students
            WHERE student_id = :studentId
            `,
            {
                studentId
            }
        );

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Check semester
        const semesterCheck = await connection.execute(
            `
            SELECT semester_id
            FROM semesters
            WHERE semester_id = :semesterId
              AND student_id = :studentId
            `,
            {
                semesterId,
                studentId
            }
        );

        if (semesterCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Semester not found for this student"
            });
        }

        // Find subject
        const subjectResult = await connection.execute(
            `
            SELECT subject_id
            FROM subjects
            WHERE LOWER(subject_name) = LOWER(:subjectName)
            `,
            {
                subjectName
            }
        );

        let subjectId;

        // Existing subject
        if (subjectResult.rows.length > 0) {

            subjectId = subjectResult.rows[0][0];

        } else {

            // New subject
            const newSubject = await connection.execute(
                `
                INSERT INTO subjects
                    (subject_name, credits)
                VALUES
                    (:subjectName, :credits)
                RETURNING subject_id INTO :subjectId
                `,
                {
                    subjectName,
                    credits,
                    subjectId: {
                        dir: oracledb.BIND_OUT,
                        type: oracledb.NUMBER
                    }
                }
            );

            subjectId = newSubject.outBinds.subjectId[0];
        }

        // Convert grade point to grade
        let grade;

        if (gradePoint >= 10) {
            grade = "A+";
        } else if (gradePoint >= 9) {
            grade = "A";
        } else if (gradePoint >= 8) {
            grade = "B+";
        } else if (gradePoint >= 7) {
            grade = "B";
        } else if (gradePoint >= 6) {
            grade = "C";
        } else if (gradePoint >= 5) {
            grade = "D";
        } else {
            grade = "F";
        }

        // Save grade
        await connection.execute(
            `
            INSERT INTO grades
                (
                    student_id,
                    semester_id,
                    subject_id,
                    grade,
                    grade_point
                )
            VALUES
                (
                    :studentId,
                    :semesterId,
                    :subjectId,
                    :grade,
                    :gradePoint
                )
            `,
            {
                studentId,
                semesterId,
                subjectId,
                grade,
                gradePoint
            }
        );

        await connection.commit();

        res.json({
            success: true,
            message: "Subject and grade saved successfully!"
        });

    } catch (error) {
        console.error("Error saving grade:", error);

        if (connection) {
            await connection.rollback();
        }

        res.status(500).json({
            success: false,
            message: "Failed to save subject and grade",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// GET SUBJECTS + GRADES
// FOR A PARTICULAR SEMESTER
// ===============================

app.get(
    "/api/student/:studentId/semester/:semesterId/grades",
    async (req, res) => {

        let connection;

        try {
            const studentId = Number(req.params.studentId);
            const semesterId = Number(req.params.semesterId);

            connection = await getConnection();

            const result = await connection.execute(
                `
                SELECT
                    s.subject_name,
                    s.credits,
                    g.grade_point
                FROM grades g
                JOIN subjects s
                    ON g.subject_id = s.subject_id
                WHERE g.student_id = :studentId
                  AND g.semester_id = :semesterId
                ORDER BY g.grade_id
                `,
                {
                    studentId,
                    semesterId
                }
            );

            res.json({
                success: true,
                grades: result.rows
            });

        } catch (error) {
            console.error("Error loading subjects:", error);

            res.status(500).json({
                success: false,
                message: "Failed to load subjects",
                error: error.message
            });

        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

// ===============================
// SGPA + CGPA SUMMARY
// ===============================

app.get("/api/student/:studentId/summary", async (req, res) => {

    let connection;

    try {
        const studentId = Number(req.params.studentId);

        connection = await getConnection();

        // Find latest semester
        const semesterResult = await connection.execute(
            `
            SELECT semester_id
            FROM semesters
            WHERE student_id = :studentId
            ORDER BY semester_number DESC
            FETCH FIRST 1 ROW ONLY
            `,
            {
                studentId
            }
        );

        if (semesterResult.rows.length === 0) {
            return res.json({
                success: true,
                sgpa: 0,
                cgpa: 0,
                credits: 0
            });
        }

        const semesterId = semesterResult.rows[0][0];

        // ===============================
        // SGPA
        // ===============================

        const sgpaResult = await connection.execute(
            `
            SELECT
                ROUND(
                    SUM(g.grade_point * s.credits)
                    /
                    NULLIF(SUM(s.credits), 0),
                    2
                ) AS sgpa,

                SUM(s.credits) AS credits

            FROM grades g

            JOIN subjects s
                ON g.subject_id = s.subject_id

            WHERE g.student_id = :studentId
              AND g.semester_id = :semesterId
            `,
            {
                studentId,
                semesterId
            }
        );

        // ===============================
        // CGPA
        // ===============================

        const cgpaResult = await connection.execute(
            `
            SELECT
                ROUND(
                    SUM(g.grade_point * s.credits)
                    /
                    NULLIF(SUM(s.credits), 0),
                    2
                ) AS cgpa,

                SUM(s.credits) AS total_credits

            FROM grades g

            JOIN subjects s
                ON g.subject_id = s.subject_id

            WHERE g.student_id = :studentId
            `,
            {
                studentId
            }
        );

        res.json({
            success: true,
            sgpa: sgpaResult.rows[0][0] || 0,
            cgpa: cgpaResult.rows[0][0] || 0,
            credits: cgpaResult.rows[0][1] || 0
        });

    } catch (error) {
        console.error("Error calculating SGPA/CGPA:", error);

        res.status(500).json({
            success: false,
            message: "Failed to calculate SGPA/CGPA",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// SEARCH STUDENT BY UID
// + RETURN SGPA / CGPA
// ===============================

app.get("/api/student/uid/:uid/summary", async (req, res) => {

    let connection;

    try {
        const uid = req.params.uid.trim();

        connection = await getConnection();

        // Find student using UID
        const studentResult = await connection.execute(
            `
            SELECT
                student_id,
                name,
                student_uid,
                branch
            FROM students
           WHERE LOWER(student_uid) = LOWER(:studentUid)
            `,
           {
    studentUid: uid
}
        );

        if (studentResult.rows.length === 0) {
            return res.json({
                success: false,
                message: "Student not found"
            });
        }

        const student = studentResult.rows[0];

        const studentId = student[0];

        // Find latest semester
        const semesterResult = await connection.execute(
            `
            SELECT semester_id
            FROM semesters
            WHERE student_id = :studentId
            ORDER BY semester_number DESC
            FETCH FIRST 1 ROW ONLY
            `,
            {
                studentId
            }
        );

        let sgpa = 0;
        let cgpa = 0;
        let credits = 0;

        if (semesterResult.rows.length > 0) {

            const semesterId = semesterResult.rows[0][0];

            // SGPA
            const sgpaResult = await connection.execute(
                `
                SELECT
                    ROUND(
                        SUM(g.grade_point * s.credits)
                        /
                        NULLIF(SUM(s.credits), 0),
                        2
                    ),
                    SUM(s.credits)

                FROM grades g

                JOIN subjects s
                    ON g.subject_id = s.subject_id

                WHERE g.student_id = :studentId
                  AND g.semester_id = :semesterId
                `,
                {
                    studentId,
                    semesterId
                }
            );

            sgpa = sgpaResult.rows[0][0] || 0;

            // Overall CGPA
            const cgpaResult = await connection.execute(
                `
                SELECT
                    ROUND(
                        SUM(g.grade_point * s.credits)
                        /
                        NULLIF(SUM(s.credits), 0),
                        2
                    ),
                    SUM(s.credits)

                FROM grades g

                JOIN subjects s
                    ON g.subject_id = s.subject_id

                WHERE g.student_id = :studentId
                `,
                {
                    studentId
                }
            );

            cgpa = cgpaResult.rows[0][0] || 0;
            credits = cgpaResult.rows[0][1] || 0;
        }

        res.json({
            success: true,

            student: {
                id: student[0],
                name: student[1],
                uid: student[2],
                branch: student[3]
            },

            sgpa,
            cgpa,
            credits
        });

    } catch (error) {
        console.error("UID search error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to search student",
            error: error.message
        });

    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
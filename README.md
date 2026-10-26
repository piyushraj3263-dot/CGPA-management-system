# Student CGPA Management System

An institutional academic database application for managing student enrollments, course evaluations, and calculating semester and cumulative grade point averages.

---

## Technical Overview
The system provides a normalized relational database schema with full referential integrity. It calculates:
- Semester Grade Point Average (SGPA) based on semester course credit weights and grade points.
- Cumulative Grade Point Average (CGPA) across all completed academic semesters.

### Design Principles:
- Institutional Aesthetic: Monochromatic slate palette, crisp borders, high contrast.
- Zero Gimmicks: No gradients, no pill buttons, no scroll animations, no decorative emojis.
- Dual-Database Architecture: Supports Oracle Cloud Database with local SQLite fallback.
- Production Ready: Configured for custom domain mapping, includes Privacy Policy and Terms of Service.

---

## Mathematical Formulation

### Semester Grade Point Average (SGPA):
The weighted average of grade points earned in courses registered within a specific semester:
SGPA = SUM(Credits * Grade Point) / SUM(Credits)

### Cumulative Grade Point Average (CGPA):
The weighted average of all grade points earned across all registered semesters:
CGPA = SUM(All Course Credits * Grade Point) / SUM(All Course Credits)

### Standard 10-Point Grade Scale:
| Letter Grade | Performance | Grade Point |
|---|---|---|
| O | Outstanding | 10 |
| A+ | Excellent | 9 |
| A | Very Good | 8 |
| B+ | Good | 7 |
| B | Above Average | 6 |
| C | Average | 5 |
| P | Pass | 4 |
| F | Fail / Backlog | 0 |

---

## Local Installation

### Prerequisites:
- Node.js (version 18.0 or higher)
- Web Browser (Chrome, Firefox, Safari, Edge)

### Setup:
1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/cgpa-management-system.git
   cd cgpa-management-system
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables (Optional):
   ```bash
   cp .env.example .env
   ```
   If environment variables are omitted, the application runs on the local SQLite database automatically.

4. Start the server:
   ```bash
   npm start
   ```

5. Access the application:
   http://localhost:3000

---

## Custom Domain & Cloud Deployment

### Deploying to Render with a Custom Domain:
1. Push your repository to GitHub.
2. In Render, create a new Web Service and select your repository.
3. Configure:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. In the Render Dashboard, go to **Settings** > **Custom Domains**.
5. Add your custom domain (e.g. `academics.youruniversity.edu`).
6. Update your DNS provider with the CNAME record provided by Render.

---

## Project Structure

```text
cgpa-management-system/
|-- index.html          # Main institutional dashboard
|-- privacy.html        # Institutional Privacy Policy
|-- terms.html          # Academic Terms and Conditions
|-- style.css           # Neutral stylesheet (no gradients, rectangular buttons)
|-- script.js           # Client-side validation and computation engine
|-- server.js           # Express server and database controller
|-- favicon.svg         # SVG favicon
|-- run_server.bat      # Windows batch starter
|-- init.sql            # Oracle DDL schema definition
|-- .env.example        # Environment variable template
|-- .gitignore          # Repository security and dependency exclusions
`-- package.json        # Node manifest and execution scripts
```

---

## Compliance and Policies
- [Privacy Policy](/privacy)
- [Terms of Service](/terms)

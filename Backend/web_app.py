from datetime import datetime
import os
from pathlib import Path
import sqlite3
from functools import wraps

import joblib
import numpy as np
from flask import Flask, jsonify, request, send_from_directory, session, redirect


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "Frontend"
MODEL_FILE = BASE_DIR / "final_model.pkl"
DB_FILE = BASE_DIR / "predictions.db"

FEATURES = [
    "anxiety",
    "depression",
    "academic_pressure",
    "study_satisfaction",
    "average_sleep",
    "social_relationships",
    "academic_workload",
    "financial_concerns",
    "isolation",
    "future_insecurity",
]

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
IS_DEVELOPMENT = APP_ENV in {"dev", "development", "local"}


def parse_credentials(raw_value):
    credentials = {}
    if not raw_value:
        return credentials

    pairs = [item.strip() for item in raw_value.split(",") if item.strip()]
    for pair in pairs:
        if ":" not in pair:
            continue
        username, password = pair.split(":", 1)
        username = username.strip().lower()
        password = password.strip()
        if username and password:
            credentials[username] = password
    return credentials


def build_demo_users():
    teacher_count = int(os.getenv("DEMO_TEACHER_COUNT", "5"))
    student_count = int(os.getenv("DEMO_STUDENT_COUNT", "25"))
    teacher_password = os.getenv("DEMO_TEACHER_PASSWORD", "teacher123")
    student_password = os.getenv("DEMO_STUDENT_PASSWORD", "student123")

    teachers = {f"teacher{i}": teacher_password for i in range(1, teacher_count + 1)}
    students = {f"student{i}": student_password for i in range(1, student_count + 1)}
    return {"teacher": teachers, "student": students}


ENV_USERS = {
    "student": parse_credentials(os.getenv("STUDENT_CREDENTIALS", "")),
    "teacher": parse_credentials(os.getenv("TEACHER_CREDENTIALS", "")),
}

if ENV_USERS["student"] and ENV_USERS["teacher"]:
    USERS = ENV_USERS
elif IS_DEVELOPMENT:
    USERS = build_demo_users()
else:
    USERS = {"student": {}, "teacher": {}}

def build_default_assignment_seed():
    def local_sort_username(name):
        prefix = ''.join(character for character in name if not character.isdigit())
        suffix = ''.join(character for character in name if character.isdigit())
        return (prefix, int(suffix or 0))

    students = sorted(USERS["student"].keys(), key=local_sort_username)
    teachers = sorted(USERS["teacher"].keys(), key=local_sort_username)
    if not students or not teachers:
        return {}

    seed = {}
    for index, student in enumerate(students):
        seed[student] = teachers[index % len(teachers)]
    return seed


DEFAULT_ASSIGNMENT_SEED = build_default_assignment_seed()

MODEL = joblib.load(MODEL_FILE)
APP = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
secret_key = os.getenv("APP_SECRET_KEY", "")
if not secret_key:
    if IS_DEVELOPMENT:
        secret_key = "mindwell-dev-secret-key"
    else:
        raise RuntimeError("APP_SECRET_KEY must be set when APP_ENV is not development.")
APP.secret_key = secret_key


def get_db_connection():
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def sort_username(name):
    prefix = ''.join(character for character in name if not character.isdigit())
    suffix = ''.join(character for character in name if character.isdigit())
    return (prefix, int(suffix or 0))


def init_db():
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            mood TEXT,
            anxiety REAL,
            depression REAL,
            academic_pressure REAL,
            study_satisfaction REAL,
            average_sleep REAL,
            social_relationships REAL,
            academic_workload REAL,
            financial_concerns REAL,
            isolation REAL,
            future_insecurity REAL,
            prediction INTEGER,
            label TEXT,
            low_prob REAL,
            medium_prob REAL,
            high_prob REAL,
            stress_score REAL,
            mental_health_index REAL,
            social_support_score REAL,
            stress_load_index REAL,
            lifestyle_risk REAL,
            emotional_stability REAL,
            suggestion TEXT,
            insight TEXT,
            created_at TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS student_teacher_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_username TEXT NOT NULL UNIQUE,
            teacher_username TEXT NOT NULL,
            assigned_at TEXT NOT NULL
        )
        """
    )
    connection.commit()
    ensure_default_assignments(connection)
    connection.close()


def get_known_students():
    return sorted(USERS["student"].keys(), key=sort_username)


def get_known_teachers():
    return sorted(USERS["teacher"].keys(), key=sort_username)


def ensure_default_assignments(connection=None):
    owns_connection = connection is None
    if connection is None:
        connection = get_db_connection()

    cursor = connection.cursor()
    existing = cursor.execute("SELECT student_username, teacher_username FROM student_teacher_assignments").fetchall()
    existing_students = {row["student_username"] for row in existing}

    for student_username, teacher_username in DEFAULT_ASSIGNMENT_SEED.items():
        if student_username in existing_students:
            continue
        cursor.execute(
            """
            INSERT INTO student_teacher_assignments (student_username, teacher_username, assigned_at)
            VALUES (?, ?, ?)
            """,
            (student_username, teacher_username, datetime.utcnow().isoformat(timespec="seconds")),
        )

    connection.commit()

    if owns_connection:
        connection.close()


def compute_explainability(values):
    stress_score = values["anxiety"] + values["depression"] + values["academic_pressure"]
    mental_health_index = (values["anxiety"] + values["depression"] + values["isolation"]) / 3
    social_support_score = values["social_relationships"] - (values["isolation"] * 0.5)
    stress_load_index = (
        values["academic_pressure"]
        + values["academic_workload"]
        - values["study_satisfaction"]
    )
    lifestyle_risk = (10 - values["average_sleep"]) + values["isolation"] + values["financial_concerns"]
    emotional_stability = values["social_relationships"] - ((values["anxiety"] + values["depression"]) / 2)

    return {
        "stress_score": stress_score,
        "mental_health_index": mental_health_index,
        "social_support_score": social_support_score,
        "stress_load_index": stress_load_index,
        "lifestyle_risk": lifestyle_risk,
        "emotional_stability": emotional_stability,
    }


def build_feature_row(payload):
    values = {}
    for field in FEATURES:
        if field not in payload:
            raise ValueError(f"Missing field: {field}")
        values[field] = float(payload[field])

    explainability = compute_explainability(values)

    row = np.array(
        [[
            values["anxiety"],
            values["depression"],
            values["academic_pressure"],
            values["study_satisfaction"],
            values["average_sleep"],
            values["social_relationships"],
            values["academic_workload"],
            values["financial_concerns"],
            values["isolation"],
            values["future_insecurity"],
            explainability["mental_health_index"],
            explainability["social_support_score"],
            explainability["stress_load_index"],
            explainability["lifestyle_risk"],
            explainability["emotional_stability"],
        ]],
        dtype=float,
    )
    return values, explainability, row


def build_suggestion_and_insight(label, explainability):
    if label == "Low Risk":
        suggestion = "Maintain your healthy routine and keep balancing sleep, social connection, and study goals."
    elif label == "Medium Risk":
        suggestion = "Try improving sleep regularity, reduce isolation, and break academic tasks into smaller blocks."
    else:
        suggestion = "High stress detected. Take immediate breaks, talk to a trusted person, and seek counselor support if needed."

    components = {
        "mental health strain": explainability["mental_health_index"],
        "academic load": explainability["stress_load_index"],
        "lifestyle risk": explainability["lifestyle_risk"],
    }
    dominant_factor = max(components, key=components.get)
    insight = f"Your current stress pattern is mainly influenced by {dominant_factor}."

    return suggestion, insight


def save_prediction(username, role, mood, values, prediction, label, probabilities, explainability, suggestion, insight):
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO predictions (
            username, role, mood,
            anxiety, depression, academic_pressure, study_satisfaction, average_sleep,
            social_relationships, academic_workload, financial_concerns, isolation, future_insecurity,
            prediction, label, low_prob, medium_prob, high_prob,
            stress_score, mental_health_index, social_support_score, stress_load_index, lifestyle_risk,
            emotional_stability, suggestion, insight, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            username,
            role,
            mood,
            values["anxiety"],
            values["depression"],
            values["academic_pressure"],
            values["study_satisfaction"],
            values["average_sleep"],
            values["social_relationships"],
            values["academic_workload"],
            values["financial_concerns"],
            values["isolation"],
            values["future_insecurity"],
            prediction,
            label,
            float(probabilities[0]),
            float(probabilities[1]),
            float(probabilities[2]),
            explainability["stress_score"],
            explainability["mental_health_index"],
            explainability["social_support_score"],
            explainability["stress_load_index"],
            explainability["lifestyle_risk"],
            explainability["emotional_stability"],
            suggestion,
            insight,
            datetime.utcnow().isoformat(timespec="seconds"),
        ),
    )
    connection.commit()
    connection.close()


def require_role(required_role):
    def decorator(handler):
        @wraps(handler)
        def wrapped(*args, **kwargs):
            username = session.get("username")
            role = session.get("role")

            if not username or not role:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Authentication required."}), 401
                return redirect("/")

            if role != required_role:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Forbidden for this role."}), 403
                return redirect("/")

            return handler(*args, **kwargs)

        return wrapped

    return decorator


@APP.get("/")
def home():
    return send_from_directory(FRONTEND_DIR, "login.html")


@APP.get("/student")
@require_role("student")
def student_page():
    return send_from_directory(FRONTEND_DIR, "student.html")


@APP.get("/teacher")
@require_role("teacher")
def teacher_page():
    return send_from_directory(FRONTEND_DIR, "teacher.html")


@APP.get("/<path:asset_path>")
def assets(asset_path):
    if asset_path.startswith("api"):
        return jsonify({"error": "Not found."}), 404
    return send_from_directory(FRONTEND_DIR, asset_path)


@APP.get("/health")
def health():
    return jsonify({"status": "ok"})


@APP.post("/api/login")
def login():
    payload = request.get_json(silent=True) or {}
    role = str(payload.get("role", "")).strip().lower()
    username = str(payload.get("username", "")).strip().lower()
    password = str(payload.get("password", ""))

    if role not in USERS:
        return jsonify({"error": "Invalid role selected."}), 400

    expected_password = USERS[role].get(username)
    if not expected_password or expected_password != password:
        return jsonify({"error": "Invalid username or password."}), 401

    session["username"] = username
    session["role"] = role

    return jsonify({"role": role, "username": username, "message": "Login successful."})


@APP.get("/api/session")
def get_session_state():
    username = session.get("username")
    role = session.get("role")
    if not username or not role:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "username": username, "role": role})


@APP.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"message": "Logged out."})


@APP.get("/api/student/teacher")
@require_role("student")
def student_teacher():
    username = str(session.get("username", "")).strip().lower()
    connection = get_db_connection()
    row = connection.execute(
        """
        SELECT student_username, teacher_username, assigned_at
        FROM student_teacher_assignments
        WHERE student_username = ?
        """,
        (username,),
    ).fetchone()
    connection.close()

    if row is None:
        return jsonify({"assignment": None})

    return jsonify({"assignment": dict(row)})


@APP.post("/api/predict")
@require_role("student")
def predict():
    payload = request.get_json(silent=True) or {}
    username = str(session.get("username", "")).strip().lower()
    role = "student"
    mood = str(payload.get("mood", "")).strip()

    try:
        values, explainability, row = build_feature_row(payload)
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    prediction = int(MODEL.predict(row)[0])
    probabilities = MODEL.predict_proba(row)[0]
    labels = {0: "Low Risk", 1: "Medium Risk", 2: "High Risk"}
    label = labels[prediction]

    suggestion, insight = build_suggestion_and_insight(label, explainability)
    save_prediction(username, role, mood, values, prediction, label, probabilities, explainability, suggestion, insight)

    return jsonify(
        {
            "prediction": prediction,
            "label": label,
            "probabilities": {
                "low": float(probabilities[0]),
                "medium": float(probabilities[1]),
                "high": float(probabilities[2]),
            },
            "risk_meter": int(round(float(probabilities[2]) * 100)),
            "breakdown": {
                "mental_health_index": round(explainability["mental_health_index"], 2),
                "academic_load": round(explainability["stress_load_index"], 2),
                "lifestyle_risk": round(explainability["lifestyle_risk"], 2),
                "social_support": round(explainability["social_support_score"], 2),
                "stress_score": round(explainability["stress_score"], 2),
            },
            "suggestion": suggestion,
            "insight": insight,
        }
    )


@APP.get("/api/history")
@require_role("student")
def history():
    username = str(session.get("username", "")).strip().lower()
    role = "student"

    connection = get_db_connection()
    rows = connection.execute(
        """
        SELECT username, role, mood, label, low_prob, medium_prob, high_prob,
               stress_score, mental_health_index, social_support_score, stress_load_index,
               lifestyle_risk, created_at
        FROM predictions
        WHERE username = ? AND role = ?
        ORDER BY id DESC
        LIMIT 30
        """,
        (username, role),
    ).fetchall()
    connection.close()

    history_rows = [dict(row) for row in rows]
    return jsonify({"history": history_rows})


@APP.get("/api/teacher/dashboard")
@require_role("teacher")
def teacher_dashboard():
    teacher_username = str(session.get("username", "")).strip().lower()
    connection = get_db_connection()
    totals = connection.execute(
        """
        SELECT
            COUNT(*) AS total_predictions,
            SUM(CASE WHEN label = 'High Risk' THEN 1 ELSE 0 END) AS high_risk_count,
            SUM(CASE WHEN label = 'Medium Risk' THEN 1 ELSE 0 END) AS medium_risk_count,
            SUM(CASE WHEN label = 'Low Risk' THEN 1 ELSE 0 END) AS low_risk_count,
            COALESCE(AVG(high_prob), 0) AS avg_high_probability
        FROM predictions p
        INNER JOIN student_teacher_assignments a
            ON a.student_username = p.username
        WHERE a.teacher_username = ?
          AND p.role = 'student'
        """
        ,
        (teacher_username,),
    ).fetchone()

    recent = connection.execute(
        """
        SELECT p.username, p.mood, p.label, p.high_prob, p.stress_score, p.created_at
        FROM predictions p
        INNER JOIN student_teacher_assignments a
            ON a.student_username = p.username
        WHERE a.teacher_username = ?
          AND p.role = 'student'
        ORDER BY p.id DESC
        LIMIT 25
        """
        ,
        (teacher_username,),
    ).fetchall()
    connection.close()

    return jsonify(
        {
            "summary": {
                "total_predictions": int(totals["total_predictions"] or 0),
                "high_risk_count": int(totals["high_risk_count"] or 0),
                "medium_risk_count": int(totals["medium_risk_count"] or 0),
                "low_risk_count": int(totals["low_risk_count"] or 0),
                "avg_high_probability": round(float(totals["avg_high_probability"] or 0), 3),
            },
            "recent_predictions": [dict(row) for row in recent],
        }
    )


@APP.post("/api/chat")
def chat_support():
    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip().lower()

    if not message:
        return jsonify({"response": "Share what you are feeling, and I can suggest focused coping steps."})

    if "stress" in message or "overwhelmed" in message:
        response = "Try a 10-minute reset: breathe slowly, list top 3 tasks, and complete the smallest one first."
    elif "sleep" in message:
        response = "Aim for a fixed sleep window tonight, avoid screens 30 minutes before bed, and limit caffeine late in the day."
    elif "exam" in message or "assignment" in message:
        response = "Use a study sprint cycle: 25 minutes focus, 5 minutes break, and track one clear outcome per sprint."
    elif "sad" in message or "anxious" in message:
        response = "You are not alone. Reach out to a friend or mentor today, and consider speaking with a counselor for extra support."
    else:
        response = "Build balance with sleep, short breaks, movement, and social support. If stress persists, seek professional help."

    return jsonify({"response": response})


if __name__ == "__main__":
    init_db()
    debug_mode = os.getenv("FLASK_DEBUG", "0").strip() == "1"
    APP.run(host="127.0.0.1", port=5000, debug=debug_mode)
# Supabase Foundation

The cloud project used for this repository is **SkillTwin**.

- Project ref: `eozvilqmrhtujqtdmrri`
- Region: `ap-southeast-2`
- Schema migration: `20260919110402_mental_health_foundation`

## Current migration status

The migration is already applied to the hosted Supabase project and creates:

- `profiles`
- `student_teacher_assignments`
- `assessments`
- `predictions`
- `user_consents`

All public tables have Row Level Security enabled.

### Privacy boundary

- Students can read their own raw assessments.
- Assigned teachers can read the student's prediction records.
- Teachers do **not** get direct access to raw assessment answers by default.
- Browser roles do not receive insert/update/delete grants for these sensitive tables.
- Trusted writes will be performed by the Flask backend after validating the authenticated Supabase user.

## Auth model

New Supabase Auth users automatically get a `profiles` row with role `student`.

A user cannot make themselves a teacher through signup metadata. Teacher/counselor/admin promotion must be performed through trusted administration.

## Local configuration

Copy the repository `.env.example` values into your local environment and replace placeholders.

Never commit `SUPABASE_SECRET_KEY`.

## Migration sequence

1. Keep the existing SQLite login/demo path working while Supabase Auth accounts are created.
2. Replace the current in-memory username/password authentication with Supabase Auth.
3. Verify bearer tokens in Flask.
4. Move prediction/history/teacher dashboard persistence from SQLite to Supabase.
5. Remove the SQLite compatibility path after end-to-end verification.
6. Rebuild the ML training pipeline and replace `legacy-v1`.

## Security verification

Immediately after applying the foundation migration, Supabase database security advisors reported no findings.

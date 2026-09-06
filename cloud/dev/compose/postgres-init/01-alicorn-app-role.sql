-- Why: services and the seed connect as this role, never as the `alicorn` superuser
-- (POSTGRES_USER) — a superuser bypasses row-level security, and the local stack
-- exists to exercise the tenant-scoped RLS the same way production does.
CREATE ROLE alicorn_app LOGIN PASSWORD 'alicorn_app';
GRANT CONNECT ON DATABASE alicorn TO alicorn_app;
CREATE SCHEMA control AUTHORIZATION alicorn_app;
CREATE SCHEMA ledger AUTHORIZATION alicorn_app;

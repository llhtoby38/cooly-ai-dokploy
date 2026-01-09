-- 002_create_images_table.sql
-- Creates a table to store every generated image for each user.
-- Run this after 001_create_auth_tables.sql

CREATE TABLE IF NOT EXISTS images (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt      TEXT         NOT NULL,
    url         TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

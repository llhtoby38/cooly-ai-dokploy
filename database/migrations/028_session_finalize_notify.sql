-- 028_session_finalize_notify.sql
-- Triggers to NOTIFY when sessions finalize (completed/failed) with a reservation_id

CREATE OR REPLACE FUNCTION notify_session_finalize()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payload json;
BEGIN
  IF NEW.reservation_id IS NOT NULL AND NEW.status IN ('completed','failed') THEN
    payload := json_build_object(
      'table', TG_TABLE_NAME,
      'session_id', NEW.id,
      'reservation_id', NEW.reservation_id,
      'status', NEW.status
    );
    PERFORM pg_notify('session_finalize', payload::text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_finalize_image ON generation_sessions;
CREATE TRIGGER trg_notify_finalize_image
AFTER UPDATE OF status ON generation_sessions
FOR EACH ROW EXECUTE FUNCTION notify_session_finalize();

DROP TRIGGER IF EXISTS trg_notify_finalize_video ON video_generation_sessions;
CREATE TRIGGER trg_notify_finalize_video
AFTER UPDATE OF status ON video_generation_sessions
FOR EACH ROW EXECUTE FUNCTION notify_session_finalize();



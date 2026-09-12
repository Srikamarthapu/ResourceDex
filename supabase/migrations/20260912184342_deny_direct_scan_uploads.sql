-- The upload API validates the verified user and signs one exact original path.
-- Deny arbitrary browser uploads so normalized/derived asset paths cannot be
-- preempted by an owner-prefix upload. Signed original uploads still work.
drop policy if exists scan_upload on storage.objects;

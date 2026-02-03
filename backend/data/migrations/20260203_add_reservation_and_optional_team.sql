ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS reservation_url TEXT;

ALTER TABLE match_players
  ALTER COLUMN team DROP NOT NULL,
  ALTER COLUMN position DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_check') THEN
    ALTER TABLE match_players DROP CONSTRAINT team_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'position_check') THEN
    ALTER TABLE match_players DROP CONSTRAINT position_check;
  END IF;
END $$;

ALTER TABLE match_players
  ADD CONSTRAINT team_check CHECK (team IS NULL OR team IN ('A', 'B')),
  ADD CONSTRAINT position_check CHECK (position IS NULL OR position BETWEEN 1 AND 5);

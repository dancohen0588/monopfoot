-- Table des votes MVP
CREATE TABLE match_mvp_votes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    voter_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    voted_for_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Contrainte : un joueur ne vote qu'une fois par match
    UNIQUE(match_id, voter_id)
);

-- Index pour les performances
CREATE INDEX idx_mvp_votes_match ON match_mvp_votes(match_id);
CREATE INDEX idx_mvp_votes_voted_for ON match_mvp_votes(voted_for_id);

-- Vue : résultats MVP par match
CREATE OR REPLACE VIEW match_mvp_results AS
SELECT 
    v.match_id,
    v.voted_for_id,
    p.first_name,
    p.last_name,
    COUNT(*) as vote_count,
    RANK() OVER (PARTITION BY v.match_id ORDER BY COUNT(*) DESC) as rank
FROM match_mvp_votes v
JOIN players p ON p.id = v.voted_for_id
GROUP BY v.match_id, v.voted_for_id, p.first_name, p.last_name;

-- Vue : stats MVP cumulées par joueur
CREATE OR REPLACE VIEW player_mvp_stats AS
SELECT 
    p.id as player_id,
    p.first_name,
    p.last_name,
    COALESCE(COUNT(CASE WHEN r.rank = 1 THEN 1 END), 0) as mvp_count,
    COALESCE(SUM(r.vote_count), 0) as total_votes_received
FROM players p
LEFT JOIN match_mvp_results r ON r.voted_for_id = p.id
GROUP BY p.id, p.first_name, p.last_name;

-- Preserve indexed reference lookups for staff retention and publication review.
CREATE INDEX redirect_publications_reviewer_idx ON app.redirect_publications(reviewer_id);

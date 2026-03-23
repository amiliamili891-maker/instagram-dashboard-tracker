-- Add creative attribute tags to ads table for performance analysis by format,
-- emotional trigger, and text angle. Enables "what's working" analysis by
-- attribute rather than just by individual ad.

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS format_category TEXT,
  ADD COLUMN IF NOT EXISTS emotional_trigger TEXT,
  ADD COLUMN IF NOT EXISTS text_angle TEXT;

-- Index for filtering/grouping by attributes
CREATE INDEX IF NOT EXISTS ads_format_category_idx ON public.ads (format_category)
  WHERE format_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS ads_emotional_trigger_idx ON public.ads (emotional_trigger)
  WHERE emotional_trigger IS NOT NULL;

COMMENT ON COLUMN public.ads.format_category IS 'Visual format family: ghostpin, notification, chat, findmy, etc.';
COMMENT ON COLUMN public.ads.emotional_trigger IS 'Primary psychological trigger: proximity, inbound, social_proof, etc.';
COMMENT ON COLUMN public.ads.text_angle IS 'Primary copy angle: nearby, anonymity, she_messaged, etc.';

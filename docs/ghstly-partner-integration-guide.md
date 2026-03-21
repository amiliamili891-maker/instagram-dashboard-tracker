# Partner API Integration Guide

## Authentication

All requests require the header:

```
X-Partner-Key: pk-ab936f383b1ee6c98535313fe1c9a73a003a2b25447d09643c202a3c1eacf6da
```

**Base URL:** `http://148.251.46.108:8400/api/partner`

All dates are in UTC-7 (Pacific Time), format `YYYY-MM-DD`.

---

## How to link Meta campaigns with our data

Our system tracks visitors via UTM parameters. When Meta sends traffic to the landing page, the URL contains:

| Meta concept | UTM param | Stored as | Our field name |
|-------------|-----------|-----------|----------------|
| Campaign ID | `utm_campaign` | `campaign_id` | `campaign_id` |
| Ad Set ID | `utm_term` | `adset_id` | `adset_id` |
| Ad ID | `utm_content` | `ad_id` | `ad_id` |

So you pull campaigns/adsets/ads from your Meta API, then call our stats endpoints with those IDs to get funnel metrics.

---

## Endpoint 1: Aggregated Stats

```
GET /api/partner/stats?start_date=2026-03-14&finish_date=2026-03-21
```

Optional filters: `campaign_id`, `adset_id`, `ad_id`

### Response

```json
{
  "items": [
    {
      "campaign_id": "120215493883700391",
      "adset_id": "120215493883710391",
      "ad_id": "120215493883720391",
      "visits": 150,
      "chats": 45,
      "reveals": 22,
      "click_throughs": 18,
      "conversions": 4
    }
  ],
  "summary": {
    "visits": 5000,
    "chats": 1200,
    "reveals": 600,
    "click_throughs": 480,
    "conversions": 120
  }
}
```

### Metrics

- **visits** — unique IPs who landed on the page
- **chats** — unique users (IP+UA) who started a chat session
- **reveals** — unique users who unlocked the model's social media
- **click_throughs** — unique users who clicked through to the model's page
- **conversions** — total subscribers

---

## Endpoint 2: Daily Stats

```
GET /api/partner/stats/daily?start_date=2026-03-14&finish_date=2026-03-21
```

Same filters as above. Returns same fields plus a `date` field per row, so you can chart daily performance.

### Response

```json
{
  "items": [
    {
      "date": "2026-03-21",
      "campaign_id": "120215493883700391",
      "adset_id": null,
      "ad_id": null,
      "visits": 50,
      "chats": 15,
      "reveals": 8,
      "click_throughs": 6,
      "conversions": 1
    }
  ]
}
```

**Important:** Rows can have `null` for `adset_id` and `ad_id` — these represent campaign-level rollup rows, not ad-level data.

---

## Example workflow for Meta dashboard

1. Call Meta Graph API to get campaigns with spend/impressions/reach
2. For each campaign, call `GET /api/partner/stats?campaign_id={meta_campaign_id}` to get chats/reveals/clicks/conversions
3. Combine Meta spend data with our funnel data to calculate CPC, cost per chat, cost per conversion, etc.
4. Use `/api/partner/stats/daily` for daily charts

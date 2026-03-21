# Ghstly Partner API Guide

**Base URL:** `https://snapper.chat/api/partner`
**Auth:** `X-Partner-Key` header on every request
**Timezone:** All dates & timestamps are in UTC-7 (Pacific Time) to match Meta Ads reporting

---

## 1. GET /sessions

List sessions with metadata. **Paginated.**

### Params
| Param | Type | Notes |
|-------|------|-------|
| `start_date` | `YYYY-MM-DD` | |
| `finish_date` | `YYYY-MM-DD` | |
| `source` | string | Optional filter |
| `campaign` | string | Meta campaign ID |
| `status` | string | |
| `brand` | string | |
| `limit` | number | Default 100, max 1000 |
| `offset` | number | For pagination |

### Response
```json
{
  "total": 4523,
  "limit": 100,
  "offset": 0,
  "items": [{
    "session_id": "abc-123",
    "created_at": "2026-03-18T15:30:00-07:00",
    "started_at": "2026-03-18T15:30:01-07:00",
    "ended_at": "2026-03-18T15:45:00-07:00",
    "status": "ended",
    "messages_count": 24,
    "brand": "Ghstly",
    "reached_reveal": true,
    "clicked_through": true,
    "converted": false,
    "campaign": "120244038939310528",
    "keyword": "120244038939320528",
    "creative": "120244039008080528",
    "city": "Los Angeles",
    "region": "California",
    "country": "US"
  }]
}
```

**Meta mapping:** `campaign` = campaign ID, `keyword` = adset ID, `creative` = ad ID

---

## 2. GET /sessions/{session_id}/messages

Full chat transcript for a session.

### Response
```json
{
  "session_id": "abc-123",
  "brand": "Ghstly",
  "status": "ended",
  "created_at": "2026-03-18T15:30:00-07:00",
  "messages_count": 24,
  "messages": [
    {"id": "msg-1", "role": "assistant", "content": "Hey! How are you?", "created_at": "2026-03-18T15:30:01-07:00"},
    {"id": "msg-2", "role": "user", "content": "Good, you?", "created_at": "2026-03-18T15:30:15-07:00"}
  ]
}
```

**Note:** Messages use `role` (not `sender`). Values are `assistant` and `user`.

---

## 3. GET /stats

Aggregated funnel stats grouped by Meta campaign hierarchy. Unique users (IP+UA) for all metrics except conversions.

### Params
| Param | Type | Notes |
|-------|------|-------|
| `start_date` | `YYYY-MM-DD` | |
| `finish_date` | `YYYY-MM-DD` | |
| `campaign_id` | string | Optional filter |
| `adset_id` | string | Optional filter |
| `ad_id` | string | Optional filter |

### Response
```json
{
  "items": [{
    "campaign_id": "120244038939310528",
    "adset_id": "120244038939320528",
    "ad_id": "120244039008080528",
    "visits": 201,
    "chats": 78,
    "reveals": 25,
    "click_throughs": 16,
    "conversions": 0
  }],
  "summary": {
    "visits": 1514,
    "chats": 907,
    "reveals": 280,
    "click_throughs": 178,
    "conversions": 3
  }
}
```

---

## 4. GET /stats/daily

Same as `/stats` but with daily breakdown. Same params.

### Response
```json
{
  "items": [
    {
      "date": "2026-03-18",
      "campaign_id": "120244038939310528",
      "adset_id": "120244038939320528",
      "ad_id": "120244039008080528",
      "visits": 101,
      "chats": 41,
      "reveals": 14,
      "click_throughs": 11,
      "conversions": 0
    },
    {
      "date": "2026-03-17",
      "campaign_id": "120244038939310528",
      "adset_id": "120244038939320528",
      "ad_id": "120244039008080528",
      "visits": 100,
      "chats": 37,
      "reveals": 11,
      "click_throughs": 5,
      "conversions": 0
    }
  ]
}
```

**Key:** Each row is one ad per day. Rows are at ad-level only (no campaign/adset rollup rows in this endpoint).

---

## Meta Field Mapping

| Field | `/stats` endpoint | `/sessions` endpoint |
|-------|------------------|---------------------|
| Campaign ID | `campaign_id` | `campaign` |
| Adset ID | `adset_id` | `keyword` |
| Ad ID | `ad_id` | `creative` |

---

## Metrics

| Metric | What it counts | Dedup |
|--------|---------------|-------|
| `visits` | Landed on page | Unique IP |
| `chats` | Started chat | Unique IP+UA |
| `reveals` | Reached reveal | Unique IP+UA |
| `click_throughs` | Clicked OF link | Unique IP+UA |
| `conversions` | Subscribed | Total (no dedup) |

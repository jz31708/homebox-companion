# Room Sweep Extraction — User Prompt Template

Analyze this Homebox Bulk Sweep chunk.

## Homebox location

- Location ID: {{location_id}}
- Location path: {{location_path}}
- Parent item: {{parent_item_name_or_none}}

## Available tags

{{tags_json}}

## Field preferences

{{field_preferences_json}}

## Custom fields

{{custom_fields_json}}

## Photos in this chunk

Each image is provided in order. Use the photo IDs below when citing evidence.

```json
{{photo_metadata_json}}
```

## Transcript spans near this chunk

```json
{{transcript_spans_json}}
```

## User instructions

{{user_extra_instructions_or_empty}}

## Task

Identify candidate Homebox inventory items in these photos using the transcript for context. Return only JSON. Every candidate must reference valid photo IDs and/or transcript span IDs.


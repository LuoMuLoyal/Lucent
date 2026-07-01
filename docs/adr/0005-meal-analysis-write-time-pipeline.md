# ADR-0005: Write-Time Meal Analysis With Imported Food Composition Data

Lucent will treat meal-image understanding as an asynchronous write-time Meal Analysis pipeline instead of an on-demand assistant retrieval feature. Meal analysis reads from an imported durable Food Composition Source in PostgreSQL, writes the current structured result into the Meal Record `payload` JSONB, and exposes that stored result to Today, Report, and Assistant read paths so nutrition commentary stays deterministic, auditable, and bounded by estimate status.

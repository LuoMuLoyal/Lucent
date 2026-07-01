# Lucent

Lucent is the backend runtime for Luminous and owns durable health-record storage, AI analysis pipelines, and structured knowledge imports. This context defines the backend terms for meal analysis so write-time processing, read APIs, and AI consumers use the same language.

## Language

**Meal Record**:
A daily record whose primary subject is one eating occasion, such as breakfast, lunch, dinner, or a snack. It is the durable backend record that owns meal analysis state, attached images, and structured meal payload data.
_Avoid_: Food photo, nutrition entry, meal attachment

**Meal Analysis**:
The asynchronous backend workflow that enriches a Meal Record from its attached image. It produces a visual description, Food Items, a Nutrition Estimate, and Meal Commentary, then writes the current result back to the Meal Record payload.
_Avoid_: Food RAG, nutrition chat, inline upload parsing

**Food Composition Source**:
The imported durable food-composition dataset derived from the purchased China food composition workbook. It is a backend-owned structured lookup source rather than a runtime file dependency or a retrieval corpus.
_Avoid_: Runtime xlsx, food vector store, spreadsheet lookup

**Food Item**:
One recognized edible item inside a Meal Record, such as rice, egg, or stir-fried vegetables. Food Items are matched against the Food Composition Source and remain separate from raw ingredient decomposition in the first phase.
_Avoid_: Ingredient decomposition, raw material split

**Nutrition Estimate**:
A structured, non-authoritative nutrition summary derived from matched Food Items and the Food Composition Source. It is explicitly an estimate, not a user-entered fact and not a medical conclusion.
_Avoid_: Exact nutrition fact, final nutrition truth, diagnosis

**Meal Commentary**:
A short rule-based summary of a meal's estimated nutrition profile, such as protein being relatively sufficient or sodium possibly being high. It is derived from structured Nutrition Estimate data rather than free-form model judgment.
_Avoid_: AI opinion, nutrition diagnosis, health verdict

**Analysis Status**:
The lifecycle state of the current Meal Analysis result stored on a Meal Record. The planned states are `analyzing`, `unconfirmed`, `confirmed`, and `analysis_failed`.
_Avoid_: Upload status, sync state

**Confirmed Meal Analysis**:
A Meal Analysis result that the user has reviewed and accepted, optionally after editing Food Items or portions. Confirmed analysis is preferred over unconfirmed analysis in longer-horizon summaries.
_Avoid_: Auto-approved result, final diagnosis

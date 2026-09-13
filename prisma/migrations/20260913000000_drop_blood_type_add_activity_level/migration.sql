-- Drop legacy blood type column (field retired from the health profile contract).
ALTER TABLE "user_profiles" DROP COLUMN "blood_type";

-- Activity level (self-reported, editable on the personal-info page).
CREATE TYPE "ActivityLevel" AS ENUM ('sedentary', 'lightlyActive', 'moderatelyActive', 'veryActive', 'extremelyActive');
ALTER TABLE "user_profiles" ADD COLUMN "activity_level" "ActivityLevel";

-- Emergency contact left the contract; scrub its keys from extras JSONB.
UPDATE "user_profiles"
SET "extras" = "extras" - 'emergencyContactName' - 'emergencyContactPhone'
WHERE "extras" ?| ARRAY['emergencyContactName', 'emergencyContactPhone'];

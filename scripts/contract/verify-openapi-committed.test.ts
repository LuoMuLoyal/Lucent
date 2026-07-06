const assert = require('node:assert/strict');
const test = require('node:test');

const { hasSemanticJsonDiff } = require('./verify-openapi-committed');

test('ignores formatting-only JSON differences', () => {
  const committed = JSON.stringify(
    {
      components: {
        schemas: {
          ApiResponse: {
            required: ['code', 'message', 'data'],
          },
        },
      },
    },
    null,
    2,
  );

  const generated = `{
  "components": {
    "schemas": {
      "ApiResponse": {
        "required": [
          "code",
          "message",
          "data"
        ]
      }
    }
  }
}`;

  assert.equal(hasSemanticJsonDiff(committed, generated), false);
});

test('detects real schema differences', () => {
  const committed = `{
  "components": {
    "schemas": {
      "CreateFileUploadDto": {
        "required": [
          "contentType",
          "sizeBytes"
        ]
      }
    }
  }
}`;

  const generated = `{
  "components": {
    "schemas": {
      "CreateFileUploadDto": {
        "required": [
          "contentType",
          "sizeBytes",
          "fileName"
        ]
      }
    }
  }
}`;

  assert.equal(hasSemanticJsonDiff(committed, generated), true);
});

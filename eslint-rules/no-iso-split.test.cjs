const { RuleTester } = require("eslint");
const rule = require("./no-iso-split.cjs");

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-iso-split", rule, {
  valid: [
    { code: "const today = todayRome();" },
    { code: "const d = date.toISOString();" },
    { code: "const parts = str.split('-');" },
    {
      code: "const today = new Date().toISOString().split('T')[0];",
      filename: "src/lib/tz.ts",
    },
  ],
  invalid: [
    {
      code: "const today = new Date().toISOString().split('T')[0];",
      filename: "src/app/page.tsx",
      errors: [{ message: /todayRome\(\) from @\/lib\/tz/ }],
    },
    {
      code: "const s = d.toISOString().split('T')[0];",
      filename: "src/lib/foo.ts",
      errors: [{ message: /todayRome\(\) from @\/lib\/tz/ }],
    },
  ],
});

console.log("no-iso-split rule passes RuleTester");

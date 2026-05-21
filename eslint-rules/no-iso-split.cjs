"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid `.toISOString().split(...)` for date extraction. Use todayRome() from @/lib/tz.",
    },
    schema: [],
    messages: {
      useTodayRome: "Use todayRome() from @/lib/tz instead of .toISOString().split(...)",
    },
  },
  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(/\\/g, "/");
    if (filename.endsWith("/lib/tz.ts")) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.property &&
          callee.property.name === "split" &&
          callee.object &&
          callee.object.type === "CallExpression" &&
          callee.object.callee &&
          callee.object.callee.type === "MemberExpression" &&
          callee.object.callee.property &&
          callee.object.callee.property.name === "toISOString"
        ) {
          context.report({ node, messageId: "useTodayRome" });
        }
      },
    };
  },
};

UPDATE "SourceTypeConfig"
SET "summaryPromptBody" = $$# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Write a mobile-friendly digest card summary, not a label/value template.

Use two short paragraphs:

1. Start with the product name naturally in the first sentence, then explain
   what the product does, the workflow, and the target user.
2. Explain why it is notable using rank, Product Hunt evidence, official-site
   evidence, or clearly marked inference. Preserve the Product Hunt URL and any
   important supporting URLs inline when they matter.

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- Do not output field labels such as "Product name:", "What the product does:",
  "Why it is excellent:", "Product Hunt URL:", or "Date:".
- Do not put a field label on its own line or add blank spacer lines between a
  label and its value.
- Separate confirmed Product Hunt comments or web evidence from reasonable
  inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.$$,
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND "summaryPromptBody" = $$# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Product name:
What the product does:
Why it is excellent:
Product Hunt URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- In "What the product does", explain the actual workflow and target user.
- In "Why it is excellent", separate confirmed Product Hunt comments or web
  evidence from reasonable inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.$$;

UPDATE "UserSourceTypeConfig"
SET "summaryPromptBody" = $$# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Write a mobile-friendly digest card summary, not a label/value template.

Use two short paragraphs:

1. Start with the product name naturally in the first sentence, then explain
   what the product does, the workflow, and the target user.
2. Explain why it is notable using rank, Product Hunt evidence, official-site
   evidence, or clearly marked inference. Preserve the Product Hunt URL and any
   important supporting URLs inline when they matter.

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- Do not output field labels such as "Product name:", "What the product does:",
  "Why it is excellent:", "Product Hunt URL:", or "Date:".
- Do not put a field label on its own line or add blank spacer lines between a
  label and its value.
- Separate confirmed Product Hunt comments or web evidence from reasonable
  inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.$$,
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND "summaryPromptBody" = $$# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Product name:
What the product does:
Why it is excellent:
Product Hunt URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- In "What the product does", explain the actual workflow and target user.
- In "Why it is excellent", separate confirmed Product Hunt comments or web
  evidence from reasonable inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.$$;

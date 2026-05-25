export const jobSkillFiles = {
  "library-once": "skills/builder-blog-digest/jobs/library-once.md",
  "digest-once": "skills/builder-blog-digest/jobs/digest-once.md",
  "library-cron-setup": "skills/builder-blog-digest/jobs/library-cron-setup.md",
  "digest-cron-setup": "skills/builder-blog-digest/jobs/digest-cron-setup.md",
  "library-cron": "skills/builder-blog-digest/jobs/library-cron.md",
  "digest-cron": "skills/builder-blog-digest/jobs/digest-cron.md",
} as const;

export type SkillJobName = keyof typeof jobSkillFiles;

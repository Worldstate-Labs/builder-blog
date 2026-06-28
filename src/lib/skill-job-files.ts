export const jobSkillFiles = {
  "library-once": "skills/builder-blog-digest/jobs/library-once.md",
  "digest-once": "skills/builder-blog-digest/jobs/digest-once.md",
  "library-cron-setup": "skills/builder-blog-digest/jobs/library-cron-setup.md",
  "library-cron-stop": "skills/builder-blog-digest/jobs/library-cron-stop.md",
  "cloud-library-cron": "skills/builder-blog-digest/jobs/cloud-library-cron.md",
  "digest-cron-setup": "skills/builder-blog-digest/jobs/digest-cron-setup.md",
  "digest-cron-stop": "skills/builder-blog-digest/jobs/digest-cron-stop.md",
  "digest-cron": "skills/builder-blog-digest/jobs/digest-cron.md",
} as const;

export type SkillJobName = keyof typeof jobSkillFiles;

export type AiSourceReviewProposal = {
  name: string;
  sourceType: "blog" | "x";
  sourceUrl: string;
  fetchUrl?: string;
  handle?: string;
  avatarDomain?: string;
  avatarUrl?: string;
};

export const AI_SOURCE_REVIEW_PROPOSALS = [
  { name: "One Useful Thing", sourceType: "blog", sourceUrl: "https://www.oneusefulthing.org/" },
  {
    name: "Chip Huyen",
    sourceType: "blog",
    sourceUrl: "https://huyenchip.com/",
    fetchUrl: "https://huyenchip.com/feed.xml",
  },
  { name: "Hamel Husain", sourceType: "blog", sourceUrl: "https://hamel.dev/" },
  { name: "Eugene Yan", sourceType: "blog", sourceUrl: "https://eugeneyan.com/" },
  { name: "Sam Altman", sourceType: "blog", sourceUrl: "https://blog.samaltman.com/" },
  { name: "Fei-Fei Li", sourceType: "blog", sourceUrl: "https://drfeifei.substack.com/" },
  { name: "François Chollet", sourceType: "x", sourceUrl: "https://x.com/fchollet", handle: "fchollet" },
  { name: "SemiAnalysis", sourceType: "blog", sourceUrl: "https://newsletter.semianalysis.com/" },
  { name: "AI Snake Oil", sourceType: "blog", sourceUrl: "https://www.aisnakeoil.com/" },
  { name: "fast.ai", sourceType: "blog", sourceUrl: "https://www.fast.ai/" },
  { name: "宝玉", sourceType: "x", sourceUrl: "https://x.com/dotey", handle: "dotey" },
  { name: "Georgi Gerganov", sourceType: "x", sourceUrl: "https://x.com/ggerganov", handle: "ggerganov" },
  { name: "World Labs", sourceType: "blog", sourceUrl: "https://www.worldlabs.ai/blog" },
  { name: "Thinking Machines Lab", sourceType: "blog", sourceUrl: "https://thinkingmachines.ai/blog/" },
  {
    name: "Apple Machine Learning Research",
    sourceType: "blog",
    sourceUrl: "https://machinelearning.apple.com/",
  },
  { name: "NVIDIA Research", sourceType: "blog", sourceUrl: "https://www.nvidia.com/en-us/research/" },
  { name: "xAI News", sourceType: "blog", sourceUrl: "https://x.ai/news" },
  { name: "Qwen Blog", sourceType: "blog", sourceUrl: "https://qwen.ai/blog" },
  { name: "DeepSeek Updates", sourceType: "blog", sourceUrl: "https://api-docs.deepseek.com/news/" },
  { name: "Ai2 News", sourceType: "blog", sourceUrl: "https://allenai.org/news" },
  { name: "Sakana AI", sourceType: "blog", sourceUrl: "https://sakana.ai/blog/" },
  { name: "Nous Research", sourceType: "x", sourceUrl: "https://x.com/NousResearch", handle: "NousResearch" },
  { name: "Unsloth", sourceType: "blog", sourceUrl: "https://unsloth.ai/blog" },
  { name: "Perplexity Blog", sourceType: "blog", sourceUrl: "https://www.perplexity.ai/hub/blog" },
  {
    name: "Artificial Analysis",
    sourceType: "blog",
    sourceUrl: "https://artificialanalysis.ai/articles",
  },
  { name: "Epoch AI", sourceType: "blog", sourceUrl: "https://epoch.ai/latest" },
  { name: "METR", sourceType: "blog", sourceUrl: "https://metr.org/blog/" },
  { name: "ARC Prize", sourceType: "blog", sourceUrl: "https://arcprize.org/blog" },
  {
    name: "Demis Hassabis",
    sourceType: "x",
    sourceUrl: "https://x.com/demishassabis",
    handle: "demishassabis",
  },
  { name: "Yann LeCun", sourceType: "x", sourceUrl: "https://x.com/ylecun", handle: "ylecun" },
  { name: "Jim Fan", sourceType: "x", sourceUrl: "https://x.com/DrJimFan", handle: "DrJimFan" },
  { name: "Thomas Wolf", sourceType: "x", sourceUrl: "https://x.com/Thom_Wolf", handle: "Thom_Wolf" },
  { name: "Ilya Sutskever", sourceType: "x", sourceUrl: "https://x.com/ilyasut", handle: "ilyasut" },
  { name: "Dario Amodei", sourceType: "x", sourceUrl: "https://x.com/DarioAmodei", handle: "DarioAmodei" },
  {
    name: "Thibault Sottiaux",
    sourceType: "x",
    sourceUrl: "https://x.com/thsottiaux",
    handle: "thsottiaux",
  },
  { name: "Nan Yu", sourceType: "x", sourceUrl: "https://x.com/thenanyu", handle: "thenanyu" },
  {
    name: "Madhu Guru",
    sourceType: "x",
    sourceUrl: "https://x.com/realmadhuguru",
    handle: "realmadhuguru",
  },
  { name: "Amjad Masad", sourceType: "x", sourceUrl: "https://x.com/amasad", handle: "amasad" },
  { name: "Guillermo Rauch", sourceType: "x", sourceUrl: "https://x.com/rauchg", handle: "rauchg" },
  { name: "Aaron Levie", sourceType: "x", sourceUrl: "https://x.com/levie", handle: "levie" },
  { name: "Matt Turck", sourceType: "x", sourceUrl: "https://x.com/mattturck", handle: "mattturck" },
] as const satisfies readonly AiSourceReviewProposal[];

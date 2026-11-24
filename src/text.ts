const en = {
  title: "Recorder",
  start: "Start recording",
  stop: "Stop and save",
  idle: "Ready",
  starting: "Starting…",
  recording: "Recording…",
  saved: "Saved",
  error: (message: string) => `Error: ${message}`,
  hint: "WAV files are saved to the plugin folder and added to the file shelf.",
};

const zhCN: typeof en = {
  title: "录音",
  start: "开始录音",
  stop: "停止并保存",
  idle: "待机",
  starting: "启动中…",
  recording: "录音中…",
  saved: "已保存",
  error: (message: string) => `错误：${message}`,
  hint: "录音以 WAV 保存到插件目录，并自动加入文件中转。",
};

export const text = navigator.language.toLowerCase().startsWith("zh") ? zhCN : en;

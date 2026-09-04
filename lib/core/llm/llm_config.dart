/// 大模型提供方。统一走 OpenAI 兼容协议（通义/文心/DeepSeek 均提供兼容模式）。
enum LlmProvider { openai, tongyi, wenxin, mock, deepseek }

/// 大模型连接配置。密钥仅存于会话内存（Web 端不落地），移动/桌面端后续接 flutter_secure_storage。
class LlmConfig {
  final LlmProvider provider;
  final String apiKey;
  final String baseUrl; // 不含 /chat/completions 后缀
  final String model;
  final double temperature;
  final int maxTokens;

  const LlmConfig({
    required this.provider,
    this.apiKey = '',
    this.baseUrl = '',
    this.model = '',
    this.temperature = 0.9,
    this.maxTokens = 600,
  });

  /// OpenAI 官方
  factory LlmConfig.openai(String apiKey, {String model = 'gpt-4o-mini'}) =>
      LlmConfig(
        provider: LlmProvider.openai,
        apiKey: apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model: model,
      );

  /// 阿里通义千问（DashScope 兼容模式）
  factory LlmConfig.tongyi(String apiKey, {String model = 'qwen-plus'}) =>
      LlmConfig(
        provider: LlmProvider.tongyi,
        apiKey: apiKey,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: model,
      );

  /// 百度文心一言（千帆兼容模式）
  factory LlmConfig.wenxin(String apiKey, {String model = 'ernie-4.0-8k'}) =>
      LlmConfig(
        provider: LlmProvider.wenxin,
        apiKey: apiKey,
        baseUrl: 'https://qianfan.baidubce.com/v2',
        model: model,
      );

  /// DeepSeek 官方（OpenAI 兼容协议，V4 系列；模型 ID 以官方文档为准）。
  factory LlmConfig.deepseek(String apiKey, {String model = 'deepseek-v4-flash'}) =>
      LlmConfig(
        provider: LlmProvider.deepseek,
        apiKey: apiKey,
        baseUrl: 'https://api.deepseek.com',
        model: model,
      );

  /// 本地演示模式：不调用任何云端 API，内置拟人化规则。
  factory LlmConfig.mock() => const LlmConfig(
        provider: LlmProvider.mock,
        apiKey: '',
        baseUrl: '',
        model: 'mock',
      );

  bool get isMock => provider == LlmProvider.mock;

  LlmConfig copyWith({
    LlmProvider? provider,
    String? apiKey,
    String? baseUrl,
    String? model,
    double? temperature,
    int? maxTokens,
  }) =>
      LlmConfig(
        provider: provider ?? this.provider,
        apiKey: apiKey ?? this.apiKey,
        baseUrl: baseUrl ?? this.baseUrl,
        model: model ?? this.model,
        temperature: temperature ?? this.temperature,
        maxTokens: maxTokens ?? this.maxTokens,
      );
}

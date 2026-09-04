import 'dart:convert';
import 'package:http/http.dart' as http;
import 'llm_config.dart';

/// 大模型调用统一接口。
abstract class LlmClient {
  Future<String> generate(String systemPrompt, String userPrompt);
}

class LlmException implements Exception {
  final String message;
  LlmException(this.message);
  @override
  String toString() => 'LlmException: $message';
}

/// 兼容 OpenAI Chat Completions 协议的客户端，可对接 OpenAI / 通义 / 文心。
class OpenAiCompatibleClient extends LlmClient {
  final LlmConfig config;
  final http.Client _http;

  OpenAiCompatibleClient(this.config) : _http = http.Client();

  @override
  Future<String> generate(String systemPrompt, String userPrompt) async {
    final uri = Uri.parse('${config.baseUrl}/chat/completions');
    final body = jsonEncode({
      'model': config.model,
      'temperature': config.temperature,
      'max_tokens': config.maxTokens,
      'messages': [
        {'role': 'system', 'content': systemPrompt},
        {'role': 'user', 'content': userPrompt},
      ],
    });
    final resp = await _http.post(
      uri,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'Bearer ${config.apiKey}',
      },
      body: body,
    );
    if (resp.statusCode != 200) {
      throw LlmException('HTTP ${resp.statusCode}: ${resp.body}');
    }
    final data = jsonDecode(utf8.decode(resp.bodyBytes)) as Map<String, dynamic>;
    final choices = data['choices'] as List< dynamic>;
    final content = choices[0]['message']['content'] as String;
    return content.trim();
  }
}

/// 演示用客户端：不联网，用一套规则把"AI 味"文本做基础口语化，便于先看 UI 效果。
class MockLlmClient extends LlmClient {
  @override
  Future<String> generate(String systemPrompt, String userPrompt) async {
    await Future.delayed(const Duration(milliseconds: 400)); // 模拟网络延迟
    return _naiveHumanize(userPrompt);
  }

  String _naiveHumanize(String text) {
    var s = text
        .replaceAll('首先，', '')
        .replaceAll('首先', '')
        .replaceAll('其次，', '')
        .replaceAll('其次', '')
        .replaceAll('然后，', '')
        .replaceAll('然后', '')
        .replaceAll('最后，', '')
        .replaceAll('最后', '')
        .replaceAll('综上所述，', '')
        .replaceAll('综上所述', '')
        .replaceAll('总之，', '')
        .replaceAll('总之', '')
        .replaceAll('因此，', '')
        .replaceAll('因此', '')
        .replaceAll('此外，', '')
        .replaceAll('此外', '')
        .replaceAll('值得注意的是', '')
        .replaceAll('总体而言', '')
        .replaceAll('这款产品', '这玩意儿')
        .replaceAll('非常适合', '挺适合')
        .replaceAll('非常', '')
        .replaceAll('值得购买', '闭眼入')
        .replaceAll('。', '！')
        .replaceAll('，', '，');
    return s;
  }
}

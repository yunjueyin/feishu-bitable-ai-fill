import '../persona/persona.dart';

/// 后处理选项：在 LLM 输出后再做一层规则化"人味"打磨。
class PostprocessOptions {
  final bool injectFillers; // 句尾注入语气词
  final bool injectCatchphrase; // 偶尔插入口头禅
  final bool injectEmoji; // 结尾加 emoji
  final bool allowTypo; // 偶尔"打错字"（默认关，避免油腻）

  const PostprocessOptions({
    this.injectFillers = true,
    this.injectCatchphrase = true,
    this.injectEmoji = true,
    this.allowTypo = false,
  });
}

const _templateWords = [
  '首先，',
  '首先',
  '其次，',
  '其次',
  '然后，',
  '然后',
  '最后，',
  '最后',
  '综上所述，',
  '综上所述',
  '总之，',
  '总之',
  '因此，',
  '因此',
  '此外，',
  '此外',
  '值得注意的是',
  '总体而言',
  '毫无疑问',
  '显而易见',
];

/// 纯 Dart 后处理：把残留的"AI 模板词"去掉，并注入口语化人味。
String postprocess(String text, Persona persona, PostprocessOptions opts) {
  var s = text.trim();
  s = _stripTemplates(s);
  s = _varyPunctuation(s);
  if (opts.injectFillers && persona.fillers.isNotEmpty) {
    s = _injectFillers(s, persona.fillers);
  }
  if (opts.injectCatchphrase && persona.catchphrases.isNotEmpty) {
    s = _injectCatchphrase(s, persona.catchphrases);
  }
  if (opts.allowTypo) s = _injectTypo(s);
  if (opts.injectEmoji && persona.emojis.isNotEmpty) {
    s = _injectEmoji(s, persona.emojis);
  }
  return s.trim();
}

String _stripTemplates(String s) {
  for (final w in _templateWords) {
    s = s.replaceAll(w, '');
  }
  return s;
}

/// 把"句长均匀"的痕迹打散：长句按逗号切分，重新拼接，制造长短不一的口语节奏。
String _varyPunctuation(String s) {
  s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  final parts = s.split(RegExp(r'[，,]'));
  if (parts.length <= 1) return s;
  final buf = StringBuffer();
  for (var i = 0; i < parts.length; i++) {
    buf.write(parts[i].trim());
    if (i < parts.length - 1) buf.write('，');
  }
  return buf.toString();
}

String _injectFillers(String s, List<String> fillers) {
  final sentences = s.split(RegExp(r'(?<=[！!?？。])'));
  final buf = StringBuffer();
  for (var i = 0; i < sentences.length; i++) {
    var seg = sentences[i];
    if (seg.isEmpty) continue;
    if (i % 2 == 1 && !_endsWithFiller(seg, fillers)) {
      final f = fillers[(i) % fillers.length];
      seg = seg.replaceFirst(RegExp(r'[！!?？。]?$'), '$f${seg.endsWith('。') || seg.endsWith('！') ? '' : ''}');
    }
    buf.write(seg);
  }
  return buf.toString();
}

bool _endsWithFiller(String s, List<String> fillers) =>
    fillers.any((f) => s.trim().endsWith(f));

String _injectCatchphrase(String s, List<String> catchphrases) {
  if (s.length < 6) return s;
  // 在开头偶尔插入口头禅，避免每句都喊口号
  final c = catchphrases[s.length % catchphrases.length];
  if (s.length % 5 != 0) return '$c，$s';
  return s;
}

String _injectTypo(String s) {
  // 极轻量：把"的"偶尔换成"得"（仍通顺），仅作 demo。默认关闭。
  if (s.contains('的') && s.length > 12) {
    return s.replaceFirst('的', '得');
  }
  return s;
}

String _injectEmoji(String s, List<String> emojis) {
  if (RegExp(r'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]', unicode: true).hasMatch(s)) {
    return s; // 已有 emoji 就不再加
  }
  final e = emojis[s.length % emojis.length];
  return '$s$e';
}

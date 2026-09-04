import 'package:flutter/material.dart';

/// 人味评分可视化组件（现代简约浅色风，零第三方依赖）。
///
/// 左侧：总评分环形进度（CustomPainter 自绘，带渐变弧 + 中心数值）。
/// 右侧：三个子维度（句长多样性 / 自然度 / 人味）条形，人味为 0 时灰显并标注「未启用」。
class QualityGauge extends StatelessWidget {
  final double total; // 0-100 总评分
  final double burstiness; // 0-100 句长多样性
  final double naturalness; // 0-100 自然度
  final double humanlikeness; // 0-100 人味（大模型自评，可能为 0）
  final String note;

  const QualityGauge({
    super.key,
    required this.total,
    required this.burstiness,
    required this.naturalness,
    required this.humanlikeness,
    this.note = '',
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        _ScoreRing(total: total),
        const SizedBox(width: 20),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _DimensionBar(label: '句长多样性', value: burstiness, color: scheme.primary),
              const SizedBox(height: 10),
              _DimensionBar(label: '自然度', value: naturalness, color: const Color(0xFF16A34A)),
              const SizedBox(height: 10),
              _DimensionBar(
                label: '人味（大模型自评）',
                value: humanlikeness,
                color: const Color(0xFFF59E0B),
                dimmed: humanlikeness <= 0,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// 总评分环形进度（自绘）。
class _ScoreRing extends StatelessWidget {
  final double total;
  const _ScoreRing({required this.total});

  @override
  Widget build(BuildContext context) {
    final color = _scoreColor(total);
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          CustomPaint(
            size: const Size(96, 96),
            painter: _RingPainter(progress: total.clamp(0, 100) / 100, color: color),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                total.toInt().toString(),
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Color(0xFF111827)),
              ),
              const Text('人味', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFF9CA3AF))),
            ],
          ),
        ],
      ),
    );
  }

  Color _scoreColor(double v) {
    if (v >= 75) return const Color(0xFF16A34A);
    if (v >= 50) return const Color(0xFF2563EB);
    if (v >= 30) return const Color(0xFFF59E0B);
    return const Color(0xFFDC2626);
  }
}

class _RingPainter extends CustomPainter {
  final double progress;
  final Color color;
  _RingPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 10.0;
    final r = (size.width - stroke) / 2;
    final c = Offset(size.width / 2, size.height / 2);

    // 背景轨道
    final track = Paint()
      ..color = const Color(0xFFE3E8EF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(c, r, track);

    // 进度弧（渐变）
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    final rect = Rect.fromCircle(center: c, radius: r);
    final gradient = SweepGradient(
      startAngle: -1.5708, // -90°
      colors: [color.withOpacity(0.55), color],
      stops: const [0.0, 1.0],
    );
    arc.shader = gradient.createShader(rect);
    canvas.drawArc(rect, -1.5708, 2 * 3.1415926535 * progress, false, arc);
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress != progress || old.color != color;
}

/// 单维度条形（自绘，带标签与数值）。
class _DimensionBar extends StatelessWidget {
  final String label;
  final double value;
  final Color color;
  final bool dimmed;
  const _DimensionBar({
    required this.label,
    required this.value,
    required this.color,
    this.dimmed = false,
  });

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0, 100);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF4B5563)))),
            Text(
              dimmed ? '未启用' : '${v.toInt()}',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: dimmed ? const Color(0xFF9CA3AF) : color,
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: SizedBox(
            height: 7,
            child: LinearProgressIndicator(
              value: dimmed ? 0 : v / 100,
              backgroundColor: const Color(0xFFEEF1F5),
              valueColor: AlwaysStoppedAnimation(color),
              minHeight: 7,
            ),
          ),
        ),
      ],
    );
  }
}

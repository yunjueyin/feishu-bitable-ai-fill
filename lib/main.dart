import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state/app_state.dart';
import 'ui/home_page.dart';

/// 应用主入口。集中维护现代简约浅色风的设计系统（颜色 / 形状 / 字体 / 组件主题）。
void main() => runApp(const App());

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (_) => AppState(),
        child: MaterialApp(
          title: 'AI 评论拟人化工具',
          debugShowCheckedModeBanner: false,
          theme: _buildTheme(),
          home: const HomePage(),
        ),
      );
}

ThemeData _buildTheme() {
  const brand = Color(0xFF2E5C8A);
  const pageBg = Color(0xFFF6F7F9);
  const surface = Color(0xFFFFFFFF);
  const outline = Color(0xFFE3E8EF);
  const textStrong = Color(0xFF111827);
  const textBody = Color(0xFF4B5563);
  const textMuted = Color(0xFF9CA3AF);

  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: pageBg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: brand,
      primary: brand,
      onPrimary: Colors.white,
      surface: surface,
      onSurface: textStrong,
      outline: outline,
      brightness: Brightness.light,
    ),
  );

  return base.copyWith(
    // 字体层级：中文优先 PingFang SC / 微软雅黑，西文 system-ui。
    textTheme: base.textTheme.copyWith(
      displaySmall: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: textStrong),
      titleLarge: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: textStrong, letterSpacing: 0.2),
      titleMedium: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: textStrong),
      bodyLarge: const TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: textBody, height: 1.5),
      bodyMedium: const TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: textBody, height: 1.5),
      labelMedium: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: textMuted),
      labelSmall: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: textMuted),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: surface,
      foregroundColor: textStrong,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleSpacing: 20,
      iconTheme: IconThemeData(color: textBody),
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: textStrong, letterSpacing: 0.2),
    ),
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      shadowColor: Colors.black.withOpacity(0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: outline, width: 1),
      ),
      margin: EdgeInsets.zero,
    ),
    dividerTheme: const DividerThemeData(color: outline, thickness: 1, space: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFFBFCFD),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: outline, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: outline, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: brand, width: 1.5),
      ),
      labelStyle: const TextStyle(color: textBody, fontSize: 13),
      hintStyle: const TextStyle(color: textMuted, fontSize: 13),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: brand,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: brand,
        side: const BorderSide(color: outline, width: 1),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: brand,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: brand.withOpacity(0.08),
      selectedColor: brand.withOpacity(0.16),
      disabledColor: outline,
      labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: brand),
      side: BorderSide(color: brand.withOpacity(0.18), width: 1),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: textStrong,
      contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: brand,
      linearTrackColor: outline,
    ),
  );
}

extension AppColors on BuildContext {
  ColorScheme get palette => Theme.of(this).colorScheme;
}

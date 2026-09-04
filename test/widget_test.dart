// 基础冒烟测试：验证应用可正常启动并渲染主页。
import 'package:flutter_test/flutter_test.dart';

import 'package:ai_humanizer/main.dart';
import 'package:ai_humanizer/ui/home_page.dart';

void main() {
  testWidgets('App 启动并显示主页标题', (WidgetTester tester) async {
    await tester.pumpWidget(const App());
    expect(find.byType(HomePage), findsOneWidget);
    expect(find.text('AI 评论拟人化工具'), findsWidgets);
  });
}

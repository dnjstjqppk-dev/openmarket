// Unit tests for the shared responsive cut-offs (must match the web breakpoints.ts core).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/theme/app_theme.dart';
import 'package:olmoa_customer/widgets/responsive.dart';

void main() {
  test('breakpoint cut-offs match the web contract', () {
    expect(OlmoaBreakpoints.phone, 360);
    expect(OlmoaBreakpoints.phoneLg, 390);
    expect(OlmoaBreakpoints.phablet, 480);
    expect(OlmoaBreakpoints.tablet, 768);
    expect(OlmoaBreakpoints.laptop, 1024);
    expect(OlmoaBreakpoints.desktop, 1280);
    expect(OlmoaBreakpoints.wide, 1440);
  });

  test('deviceOf splits phone / tablet / desktop at 768 and 1280', () {
    expect(OlmoaBreakpoints.deviceOf(360), OlmoaDevice.phone);
    expect(OlmoaBreakpoints.deviceOf(767), OlmoaDevice.phone);
    expect(OlmoaBreakpoints.deviceOf(768), OlmoaDevice.tablet);
    expect(OlmoaBreakpoints.deviceOf(1024), OlmoaDevice.tablet);
    expect(OlmoaBreakpoints.deviceOf(1279), OlmoaDevice.tablet);
    expect(OlmoaBreakpoints.deviceOf(1280), OlmoaDevice.desktop);
    expect(OlmoaBreakpoints.deviceOf(1440), OlmoaDevice.desktop);
  });

  test('grid columns grow per layout family', () {
    expect(gridColumnsForWidth(390), 2);
    expect(gridColumnsForWidth(768), 3);
    expect(gridColumnsForWidth(1024), 3);
    expect(gridColumnsForWidth(1280), 4);
  });
}

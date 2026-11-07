// OLMOA design tokens for Flutter ("OLMOA Lagoon").
// Mirrors packages/ui/src/styles/tokens.css channel-for-channel so Vue and Flutter
// render the same brand. Single source of truth on the app side: every color,
// radius and breakpoint below must come from here, never a raw hex in views.

import 'package:flutter/material.dart';

/// Raw palette. Values match tokens.css (--om-lagoon-*, --om-ruby-*, ...).
abstract final class OlmoaColors {
  // Lagoon (brand primary)
  static const Color lagoon50 = Color(0xFFE6F6F7);
  static const Color lagoon100 = Color(0xFFC2EAEE);
  static const Color lagoon200 = Color(0xFF8AD5DD);
  static const Color lagoon300 = Color(0xFF4DBCC8);
  static const Color lagoon400 = Color(0xFF1FA2B1);
  static const Color lagoon500 = Color(0xFF0F8292);
  static const Color lagoon600 = Color(0xFF0B6E79); // brand
  static const Color lagoon700 = Color(0xFF095A63);
  static const Color lagoon800 = Color(0xFF07474E);
  static const Color lagoon900 = Color(0xFF05353A);

  // Ruby (prices, discounts) / Amber (deal badges, stars)
  static const Color ruby50 = Color(0xFFFDECEF);
  static const Color ruby500 = Color(0xFFD6304A);
  static const Color ruby600 = Color(0xFFB8213A);
  static const Color amber50 = Color(0xFFFEF6DE);
  static const Color amber400 = Color(0xFFF2A900);
  static const Color amber700 = Color(0xFF8C6000);

  // Stone (neutrals)
  static const Color stone0 = Color(0xFFFFFFFF);
  static const Color stone25 = Color(0xFFFBFBFA);
  static const Color stone50 = Color(0xFFF6F6F4);
  static const Color stone100 = Color(0xFFEDEDEA);
  static const Color stone200 = Color(0xFFDCDCD7);
  static const Color stone300 = Color(0xFFC2C2BB);
  static const Color stone400 = Color(0xFF9A9A92);
  static const Color stone500 = Color(0xFF74746D);
  static const Color stone600 = Color(0xFF575752);
  static const Color stone700 = Color(0xFF3F3F3B);
  static const Color stone800 = Color(0xFF282826);
  static const Color stone900 = Color(0xFF171716);

  // Semantic
  static const Color success = Color(0xFF16804A);
  static const Color successSoft = Color(0xFFE8F6EE);
  static const Color warning = Color(0xFFB86E00);
  static const Color warningSoft = Color(0xFFFFF3E0);
  static const Color danger = Color(0xFFC8283C);
  static const Color dangerSoft = Color(0xFFFDECEE);
  static const Color info = Color(0xFF2463D1);
  static const Color infoSoft = Color(0xFFE9F0FC);
}

/// Corner radii, mirroring --om-radius-*.
abstract final class OlmoaRadii {
  static const double xs = 4;
  static const double sm = 6;
  static const double md = 10;
  static const double lg = 14;
  static const double xl = 20;
  static const double xxl = 24;
}

/// Responsive cut-offs shared with the web `breakpoints.ts` core.
abstract final class OlmoaBreakpoints {
  static const double phone = 360;
  static const double phoneLg = 390;
  static const double phablet = 480;
  static const double tablet = 768;
  static const double laptop = 1024;
  static const double desktop = 1280;
  static const double wide = 1440;

  /// Layout family: bottom-nav phone, two-column tablet, rail/multi-column desktop.
  static OlmoaDevice deviceOf(double width) {
    if (width >= desktop) return OlmoaDevice.desktop;
    if (width >= tablet) return OlmoaDevice.tablet;
    return OlmoaDevice.phone;
  }
}

enum OlmoaDevice { phone, tablet, desktop }

ThemeData buildOlmoaLightTheme() {
  const scheme = ColorScheme.light(
    primary: OlmoaColors.lagoon600,
    onPrimary: OlmoaColors.stone0,
    primaryContainer: OlmoaColors.lagoon50,
    onPrimaryContainer: OlmoaColors.lagoon800,
    secondary: OlmoaColors.stone900,
    onSecondary: OlmoaColors.stone0,
    surface: OlmoaColors.stone0,
    onSurface: OlmoaColors.stone900,
    surfaceContainerHighest: OlmoaColors.stone100,
    error: OlmoaColors.danger,
    onError: OlmoaColors.stone0,
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: OlmoaColors.stone25,
    // NOTE: Pretendard ships via the web bundle; Flutter falls back to the
    // platform sans until the font asset is added (P1). No custom fontFamily set.
    appBarTheme: const AppBarTheme(
      backgroundColor: OlmoaColors.stone0,
      foregroundColor: OlmoaColors.stone900,
      elevation: 0,
      scrolledUnderElevation: 1,
    ),
    cardTheme: CardThemeData(
      color: OlmoaColors.stone0,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(OlmoaRadii.lg),
        side: const BorderSide(color: OlmoaColors.stone200),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: OlmoaColors.lagoon600,
        foregroundColor: OlmoaColors.stone0,
        minimumSize: const Size(44, 44), // 44px touch target
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(OlmoaRadii.md)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(44, 44),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(OlmoaRadii.md)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: OlmoaColors.stone0,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(OlmoaRadii.md),
        borderSide: const BorderSide(color: OlmoaColors.stone300),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(OlmoaRadii.md),
        borderSide: const BorderSide(color: OlmoaColors.stone300),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(OlmoaRadii.md),
        borderSide: const BorderSide(color: OlmoaColors.lagoon500, width: 2),
      ),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      selectedItemColor: OlmoaColors.lagoon600,
      unselectedItemColor: OlmoaColors.stone400,
      type: BottomNavigationBarType.fixed,
    ),
    navigationRailTheme: const NavigationRailThemeData(
      backgroundColor: OlmoaColors.stone0,
      selectedIconTheme: IconThemeData(color: OlmoaColors.lagoon600),
      unselectedIconTheme: IconThemeData(color: OlmoaColors.stone400),
      selectedLabelTextStyle:
          TextStyle(color: OlmoaColors.lagoon700, fontWeight: FontWeight.w700),
      unselectedLabelTextStyle: TextStyle(color: OlmoaColors.stone500),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: OlmoaColors.stone900,
      contentTextStyle: TextStyle(color: OlmoaColors.stone0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(OlmoaRadii.md)),
      ),
    ),
    progressIndicatorTheme:
        const ProgressIndicatorThemeData(color: OlmoaColors.lagoon600),
    badgeTheme: const BadgeThemeData(backgroundColor: OlmoaColors.ruby500),
  );
}

ThemeData buildOlmoaDarkTheme() {
  const scheme = ColorScheme.dark(
    primary: OlmoaColors.lagoon400,
    onPrimary: Color(0xFF051E21),
    primaryContainer: Color(0xFF093439),
    onPrimaryContainer: OlmoaColors.lagoon100,
    secondary: Color(0xFFECEBE7),
    onSecondary: OlmoaColors.stone900,
    surface: Color(0xFF16191A),
    onSurface: Color(0xFFECEBE7),
    error: Color(0xFFF06674),
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: const Color(0xFF0E1011),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF16191A),
      foregroundColor: Color(0xFFECEBE7),
      elevation: 0,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(minimumSize: const Size(44, 44)),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      selectedItemColor: OlmoaColors.lagoon300,
      unselectedItemColor: OlmoaColors.stone500,
      type: BottomNavigationBarType.fixed,
    ),
  );
}

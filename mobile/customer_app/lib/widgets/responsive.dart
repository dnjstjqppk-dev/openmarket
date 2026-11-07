// Responsive helpers shared by customer views. Layouts branch on the same
// cut-offs as the web (OlmoaBreakpoints): phone < 768, tablet 768-1279,
// desktop/rail >= 1024 (tablets in landscape) with multi-column content.

import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Product-grid column count per layout family. Tablet shows more columns
/// instead of stretching phone cards; desktop caps content width in the view.
int gridColumnsForWidth(double width,
    {int phone = 2, int tablet = 3, int desktop = 4}) {
  final device = OlmoaBreakpoints.deviceOf(width);
  if (device == OlmoaDevice.desktop) return desktop;
  if (device == OlmoaDevice.tablet) return tablet;
  return phone;
}

/// Centers [child] and caps its width on tablet/desktop so phones keep the
/// full-bleed list while larger screens get a readable content column.
class AdaptiveContent extends StatelessWidget {
  final Widget child;
  final double maxWidth;

  const AdaptiveContent({super.key, required this.child, this.maxWidth = 960});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < OlmoaBreakpoints.tablet) return child;
        return Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: child,
          ),
        );
      },
    );
  }
}

/// Phone: bottom navigation. Tablet landscape / desktop (>= 1024):
/// side navigation rail + content, per the commercial layout spec.
class AdaptiveScaffold extends StatelessWidget {
  final PreferredSizeWidget appBar;
  final Widget body;
  final int currentIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<NavigationDestination> destinations;

  const AdaptiveScaffold({
    super.key,
    required this.appBar,
    required this.body,
    required this.currentIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= OlmoaBreakpoints.laptop;
        if (!wide) {
          return Scaffold(
            appBar: appBar,
            body: SafeArea(child: body),
            bottomNavigationBar: NavigationBar(
              selectedIndex: currentIndex,
              onDestinationSelected: onDestinationSelected,
              destinations: destinations,
            ),
          );
        }
        return Scaffold(
          appBar: appBar,
          body: SafeArea(
            child: Row(
              children: [
                NavigationRail(
                  selectedIndex: currentIndex,
                  onDestinationSelected: onDestinationSelected,
                  labelType: NavigationRailLabelType.all,
                  destinations: [
                    for (final d in destinations)
                      NavigationRailDestination(
                        icon: d.icon,
                        selectedIcon: d.selectedIcon,
                        label: Text(d.label),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: body),
              ],
            ),
          ),
        );
      },
    );
  }
}

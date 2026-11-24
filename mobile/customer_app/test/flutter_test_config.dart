import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

// CI runs on Linux while goldens were captured on Windows: identical layouts
// differ by ~0.1-0.25% of pixels (font anti-aliasing noise; observed 0.09% /
// 717px and 0.23% / 770px on ubuntu-latest). A 0.5% tolerance absorbs that
// noise while still catching real layout regressions (which shift >>1%).
const double kGoldenTolerance = 0.005;

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  // `flutter test` runs with CWD = package root; golden keys are relative
  // to test/. LocalFileComparator takes a *file* URI and derives basedir
  // from its dirname, so anchor inside test/ (need not exist).
  final Uri anchor = Directory.current.uri.resolve('test/_golden_anchor.dart');
  goldenFileComparator = _TolerantFileComparator(anchor, kGoldenTolerance);
  await testMain();
}

class _TolerantFileComparator extends LocalFileComparator {
  _TolerantFileComparator(super.testFile, this.tolerance);

  final double tolerance;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final ComparisonResult result = await GoldenFileComparator.compareLists(
      imageBytes,
      await getGoldenBytes(golden),
    );
    if (result.passed || result.diffPercent <= tolerance) {
      result.dispose();
      return true;
    }
    // Preserve the default failure report (diff PNG + pixel counts).
    result.dispose();
    return super.compare(imageBytes, golden);
  }
}

// Carrier parity pin: the partner app dispatch dialog must offer the same
// carriers as the web seller console (ShipmentView carrierOptions).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/views/shipment_view.dart';

void main() {
  test('dispatch dialog offers the web-console carrier set', () {
    expect(
      shipmentCarrierOptions,
      orderedEquals([
        'CJ대한통운 국제특송',
        'DHL Express',
        'FedEx International',
        '우체국 국제특송 (EMS)',
        '차이냐오 글로벌 (Cainiao)',
        '순풍 익스프레스 (SF Express)',
      ]),
    );
  });
}

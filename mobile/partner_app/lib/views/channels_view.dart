// mobile/partner_app/lib/views/channels_view.dart
// Wave G2: multichannel — listing status, single-product publish with the
// web console's required fields, per-channel order sync, and platform
// credential registration/verification. 501 and simulated answers are shown
// honestly, never as a live listing.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/channel_listing.dart';
import '../models/partner_product.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

String _won(num v) => '₩${NumberFormat('#,###').format(v)}';

class PartnerChannelsView extends StatefulWidget {
  const PartnerChannelsView({super.key});

  @override
  State<PartnerChannelsView> createState() => _PartnerChannelsViewState();
}

class _PartnerChannelsViewState extends State<PartnerChannelsView>
    with SingleTickerProviderStateMixin {
  final PartnerApiService _api = PartnerApiService();
  late final TabController _tabs;
  List<ChannelListing> _listings = [];
  List<SalesChannel> _channels = [];
  List<CommercePlatform> _platforms = [];
  List<ChannelCredential> _credentials = [];
  List<PartnerProductRow> _products = [];
  bool _loading = true;
  bool _authReady = false;
  List<String> _loadErrors = [];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _init();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    await PartnerAuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (PartnerAuthSession.isAuthenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadErrors = [];
    });
    final failures = <String>[];
    Future<void> guard(String label, Future<void> Function() fn) async {
      try {
        await fn();
      } on PartnerAuthRequiredException {
        if (mounted) setState(() {});
        throw const _AbortLoad();
      } on PartnerApiException catch (e) {
        failures.add('$label: ${e.message}');
      }
    }

    try {
      await guard('리스팅', () async {
        final v = await _api.fetchChannelListings();
        if (mounted) setState(() => _listings = v);
      });
      await guard('판매채널', () async {
        final v = await _api.fetchSalesChannels();
        if (mounted) setState(() => _channels = v);
      });
      await guard('플랫폼', () async {
        final v = await _api.fetchPlatforms();
        if (mounted) setState(() => _platforms = v);
      });
      await guard('인증정보', () async {
        final v = await _api.fetchChannelCredentials();
        if (mounted) setState(() => _credentials = v);
      });
      await guard('상품', () async {
        final v = await _api.fetchProducts();
        if (mounted) setState(() => _products = v);
      });
    } on _AbortLoad {
      return;
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _loadErrors = failures;
      });
    }
  }

  bool _hasCredential(String platformId) =>
      _credentials.any((c) => c.platformId == platformId);

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '채널을 관리하려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        if (_loadErrors.isNotEmpty)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFCE8E6),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(_loadErrors.join('\n'),
                      style: const TextStyle(
                          color: Color(0xFFC5221F), fontSize: 12)),
                ),
                TextButton(
                    onPressed: _load, child: const Text('다시 시도')),
              ],
            ),
          ),
        TabBar(
          controller: _tabs,
          labelColor: OlmoaColors.lagoon700,
          tabs: [
            Tab(text: '리스팅 ${_listings.length}'),
            Tab(text: '채널·계정 ${_channels.length}'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _listingsTab(),
              _channelsTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _listingsTab() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            children: [
              Text('외부 채널 등록 현황',
                  style: TextStyle(
                      color: Colors.grey.shade600, fontSize: 12)),
              const Spacer(),
              TextButton.icon(
                onPressed: () => _openPublishSheet(context),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('채널에 배포'),
              ),
            ],
          ),
        ),
        Expanded(
          child: _listings.isEmpty
              ? const Center(child: Text('등록된 리스팅이 없습니다.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: _listings.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final l = _listings[i];
                      return Card(
                        margin: EdgeInsets.zero,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  _chip(
                                      l.statusLabel,
                                      l.status == 'SYNC_FAILED'
                                          ? const Color(0xFFC5221F)
                                          : OlmoaColors.lagoon700,
                                      l.status == 'SYNC_FAILED'
                                          ? const Color(0xFFFCE8E6)
                                          : OlmoaColors.lagoon700.withValues(
                                              alpha: 0.1)),
                                  const Spacer(),
                                  Text(l.channelName,
                                      style: TextStyle(
                                          color: Colors.grey.shade600,
                                          fontSize: 11)),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(l.productTitle,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14)),
                              const SizedBox(height: 4),
                              Text(
                                  '채널가 ${_won(l.channelSalePrice)} · 배정 재고 ${_listings[i].stockAllocated}개',
                                  style: const TextStyle(fontSize: 13)),
                              if ((l.externalProductId ?? '').isNotEmpty)
                                Text('외부 상품번호: ${l.externalProductId}',
                                    style: TextStyle(
                                        color: Colors.grey.shade600,
                                        fontSize: 12)),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Widget _channelsTab() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('판매채널',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (_channels.isEmpty)
            const Text('등록된 판매채널이 없습니다.',
                style: TextStyle(color: Colors.grey, fontSize: 13)),
          for (final ch in _channels) ...[
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(ch.channelName,
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 14)),
                        ),
                        _chip(
                            _hasCredential(ch.platformId) ? '계정 등록됨' : '계정 없음',
                            _hasCredential(ch.platformId)
                                ? const Color(0xFF1E7E34)
                                : const Color(0xFF8A5A00),
                            _hasCredential(ch.platformId)
                                ? const Color(0xFFE6F4EA)
                                : const Color(0xFFFFF3DC)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                        '${ch.platformName} · 수수료 ${ch.commissionLabel}',
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 12)),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _syncOrders(ch),
                        icon: const Icon(Icons.sync, size: 18),
                        label: const Text('주문 수집'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              const Text('플랫폼 계정',
                  style:
                      TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
              const Spacer(),
              TextButton.icon(
                onPressed: () => _openCredentialSheet(context),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('계정 등록'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_credentials.isEmpty)
            const Text('등록된 계정이 없습니다.',
                style: TextStyle(color: Colors.grey, fontSize: 13)),
          for (final cred in _credentials) ...[
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                              '${cred.platformName} · ${cred.credentialName}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 14)),
                        ),
                        _chip(
                            cred.statusLabel,
                            cred.status == 'VERIFIED'
                                ? const Color(0xFF1E7E34)
                                : OlmoaColors.lagoon700,
                            cred.status == 'VERIFIED'
                                ? const Color(0xFFE6F4EA)
                                : OlmoaColors.lagoon700
                                    .withValues(alpha: 0.1)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('키 ${cred.apiKeyMasked}${cred.isSandbox ? ' · 샌드박스' : ''}',
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 12)),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => _verifyCredential(cred),
                        child: const Text('연결 검증'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, Color fg, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child:
          Text(label, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Future<void> _syncOrders(SalesChannel ch) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${ch.channelName} 주문을 수집합니다...')),
    );
    final res = await _api.syncChannelOrders(ch.id);
    if (!mounted) return;
    if (res['ok'] == true) {
      final data =
          res['data'] is Map<String, dynamic> ? res['data'] as Map<String, dynamic> : <String, dynamic>{};
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((data['message'] ?? '주문이 동기화되었습니다.').toString())),
      );
      _load();
    } else if (res['status'] == 501) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                '${ch.channelName} API가 아직 연동되지 않아 수집할 수 없습니다.')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((res['error'] ?? '주문 수집에 실패했습니다.').toString())),
      );
    }
  }

  Future<void> _verifyCredential(ChannelCredential cred) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${cred.platformName} 연결을 검증합니다...')),
    );
    final res = await _api.verifyCredential(cred.id);
    if (!mounted) return;
    if (res['ok'] == true) {
      final data =
          res['data'] is Map<String, dynamic> ? res['data'] as Map<String, dynamic> : <String, dynamic>{};
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((data['message'] ?? '검증 결과를 확인했습니다.').toString())),
      );
      _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((res['error'] ?? '검증에 실패했습니다.').toString())),
      );
    }
  }

  Future<void> _openPublishSheet(BuildContext context) async {
    // The server only publishes ACTIVE (review-approved) products.
    final seen = <String>{};
    final deployable = _products.where((p) {
      if (p.status != 'ACTIVE' || !seen.add(p.id)) return false;
      return true;
    }).toList();
    String? productId = deployable.length == 1 ? deployable.first.id : null;
    String? channelId = _channels.length == 1 ? _channels.first.id : null;
    final brand = TextEditingController();
    final courier = TextEditingController();
    final category = TextEditingController();
    final salePrice = TextEditingController();
    String? formError;
    var busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 16,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('채널에 배포',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const Text('심사 승인(판매중) 상품만 외부 채널에 등록할 수 있습니다.',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: productId,
                  decoration: const InputDecoration(
                      labelText: '상품 *', border: OutlineInputBorder()),
                  items: deployable
                      .map((p) => DropdownMenuItem(
                          value: p.id, child: Text(p.title)))
                      .toList(),
                  onChanged: (v) => setSheet(() => productId = v),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: channelId,
                  decoration: const InputDecoration(
                      labelText: '판매채널 *', border: OutlineInputBorder()),
                  items: _channels
                      .map((c) => DropdownMenuItem(
                          value: c.id,
                          child: Text(
                              '${c.channelName} (수수료 ${c.commissionLabel})')))
                      .toList(),
                  onChanged: (v) => setSheet(() => channelId = v),
                ),
                const SizedBox(height: 10),
                TextField(
                    controller: brand,
                    decoration: const InputDecoration(
                        labelText: '브랜드 *', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: courier,
                    decoration: const InputDecoration(
                        labelText: '배송 택배사 *',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: category,
                    decoration: const InputDecoration(
                        labelText: '채널 카테고리 ID *',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: salePrice,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: '채널 판매가(원, 비우면 올모아 판매가)',
                        border: OutlineInputBorder())),
                if (formError != null) ...[
                  const SizedBox(height: 8),
                  Text(formError!,
                      style:
                          const TextStyle(color: Colors.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateChannelPublish(
                              productId: productId,
                              salesChannelId: channelId,
                              brand: brand.text,
                              deliveryCompany: courier.text,
                              externalCategoryId: category.text,
                              salePriceRaw: salePrice.text,
                            );
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final payload = <String, dynamic>{
                              'product_id': productId,
                              'sales_channel_id': channelId,
                              'brand': brand.text.trim(),
                              'delivery_company': courier.text.trim(),
                              'external_category_id': category.text.trim(),
                            };
                            if (salePrice.text.trim().isNotEmpty) {
                              payload['sale_price'] = int.parse(salePrice.text
                                  .replaceAll(RegExp(r'[,\s]'), ''));
                            }
                            final res =
                                await _api.publishToChannel(payload);
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              final data = res['data']
                                      is Map<String, dynamic>
                                  ? res['data'] as Map<String, dynamic>
                                  : <String, dynamic>{};
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(data['simulated'] == true
                                        ? '시뮬레이션으로 기록되었습니다. 외부 API 연동 전에는 실제 채널에 등록되지 않습니다.'
                                        : (data['message'] ??
                                                '채널에 배포되었습니다.')
                                            .toString())),
                              );
                              _load();
                            } else if (res['status'] == 501) {
                              setSheet(() {
                                busy = false;
                                formError =
                                    '외부 채널 API가 아직 연동되지 않아 배포할 수 없습니다.';
                              });
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '배포 실패')
                                    .toString();
                              });
                            }
                          },
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : const Text('배포하기',
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    brand.dispose();
    courier.dispose();
    category.dispose();
    salePrice.dispose();
  }

  Future<void> _openCredentialSheet(BuildContext context) async {
    String? platformId = _platforms.length == 1 ? _platforms.first.id : null;
    final name = TextEditingController(text: '기본 계정');
    final apiKey = TextEditingController();
    final secret = TextEditingController();
    final seller = TextEditingController();
    String? formError;
    var busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 16,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('플랫폼 계정 등록',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const Text('인증정보는 암호화되어 저장되며, 키 원문은 다시 보여주지 않습니다.',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: platformId,
                  decoration: const InputDecoration(
                      labelText: '플랫폼 *', border: OutlineInputBorder()),
                  items: _platforms
                      .map((p) => DropdownMenuItem(
                          value: p.id,
                          child: Text(
                              '${p.name}${p.apiIntegrated ? '' : ' (API 미연동)'}')))
                      .toList(),
                  onChanged: (v) => setSheet(() => platformId = v),
                ),
                const SizedBox(height: 10),
                TextField(
                    controller: name,
                    decoration: const InputDecoration(
                        labelText: '계정 이름', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: apiKey,
                    obscureText: true,
                    decoration: const InputDecoration(
                        labelText: 'API 키 *', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: secret,
                    obscureText: true,
                    decoration: const InputDecoration(
                        labelText: '시크릿 키(선택)',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: seller,
                    decoration: const InputDecoration(
                        labelText: '판매자 계정 ID(선택)',
                        border: OutlineInputBorder())),
                if (formError != null) ...[
                  const SizedBox(height: 8),
                  Text(formError!,
                      style:
                          const TextStyle(color: Colors.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateChannelCredential(
                              platformId: platformId,
                              apiKey: apiKey.text,
                            );
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.saveCredential(
                              platformId: platformId!,
                              credentialName: name.text.trim().isEmpty
                                  ? '기본 계정'
                                  : name.text.trim(),
                              apiKey: apiKey.text.trim(),
                              secretKey: secret.text.trim(),
                              sellerAccountId: seller.text.trim(),
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              final data = res['data']
                                      is Map<String, dynamic>
                                  ? res['data'] as Map<String, dynamic>
                                  : <String, dynamic>{};
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text((data['message'] ??
                                            '인증정보가 저장되었습니다.')
                                        .toString())),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '저장 실패')
                                    .toString();
                              });
                            }
                          },
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : const Text('등록',
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    name.dispose();
    apiKey.dispose();
    secret.dispose();
    seller.dispose();
  }
}

class _AbortLoad implements Exception {
  const _AbortLoad();
}

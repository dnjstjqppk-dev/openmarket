// mobile/partner_app/lib/views/qna_view.dart
// Wave G2: seller product Q&A — unanswered/answered filter, search, and the
// answer form (2,000 chars, mirrored from routes/partner.js).

import 'package:flutter/material.dart';
import '../models/partner_qna.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

String _shortDate(String iso) {
  if (iso.length >= 16) return iso.substring(0, 16).replaceAll('T', ' ');
  return iso;
}

class PartnerQnaView extends StatefulWidget {
  const PartnerQnaView({super.key});

  @override
  State<PartnerQnaView> createState() => _PartnerQnaViewState();
}

class _PartnerQnaViewState extends State<PartnerQnaView> {
  final PartnerApiService _api = PartnerApiService();
  List<PartnerQna> _rows = [];
  bool _loading = true;
  bool _authReady = false;
  String? _error;
  String _filter = 'ALL';
  String _query = '';

  @override
  void initState() {
    super.initState();
    _init();
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
      _error = null;
    });
    try {
      final rows = await _api.fetchQna();
      if (mounted) setState(() => _rows = rows);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  List<PartnerQna> get _filtered {
    final q = _query.trim().toLowerCase();
    return _rows.where((r) {
      if (_filter == 'WAITING' && r.answered) return false;
      if (_filter == 'ANSWERED' && !r.answered) return false;
      if (q.isEmpty) return true;
      return r.productTitle.toLowerCase().contains(q) ||
          r.question.toLowerCase().contains(q) ||
          r.questionerName.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: 'Q&A를 확인하려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    final rows = _filtered;
    final waiting = _rows.where((r) => !r.answered).length;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              ChoiceChip(
                label: const Text('전체'),
                selected: _filter == 'ALL',
                onSelected: (_) => setState(() => _filter = 'ALL'),
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: Text('미답변 $waiting'),
                selected: _filter == 'WAITING',
                onSelected: (_) => setState(() => _filter = 'WAITING'),
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('답변 완료'),
                selected: _filter == 'ANSWERED',
                onSelected: (_) => setState(() => _filter = 'ANSWERED'),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(
              hintText: '상품명·질문·작성자 검색',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text('해당 문의가 없습니다.',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 13)),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _qnaCard(context, rows[i]),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _qnaCard(BuildContext context, PartnerQna q) {
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
                  q.statusLabel,
                  q.answered
                      ? const Color(0xFF1E7E34)
                      : const Color(0xFF8A5A00),
                  q.answered
                      ? const Color(0xFFE6F4EA)
                      : const Color(0xFFFFF3DC),
                ),
                if (q.isSecret) ...[
                  const SizedBox(width: 6),
                  _chip('비밀글', Colors.grey.shade700, Colors.grey.shade200),
                ],
                const Spacer(),
                Text(_shortDate(q.createdAt),
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 11)),
              ],
            ),
            const SizedBox(height: 8),
            Text(q.productTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 2),
            Text('Q. ${q.question}', style: const TextStyle(fontSize: 13)),
            Text('— ${q.questionerName}',
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            if (q.answered && (q.answer ?? '').isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: OlmoaColors.lagoon700.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('A. ${q.answer}',
                    style: const TextStyle(fontSize: 13)),
              ),
            ],
            if (!q.answered) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _openAnswerSheet(context, q),
                  child: const Text('답변하기'),
                ),
              ),
            ],
          ],
        ),
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

  Future<void> _openAnswerSheet(BuildContext context, PartnerQna q) async {
    final answer = TextEditingController();
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
                const Text('Q&A 답변',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                Text(q.productTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: Colors.grey.shade600, fontSize: 12)),
                const SizedBox(height: 8),
                Text('Q. ${q.question}',
                    style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 12),
                TextField(
                  controller: answer,
                  maxLines: 5,
                  maxLength: 2000,
                  decoration: const InputDecoration(
                    labelText: '답변 *',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (formError != null)
                  Text(formError!,
                      style:
                          const TextStyle(color: Colors.red, fontSize: 12)),
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateQnaAnswer(answer.text);
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.postQnaAnswer(
                              qnaId: q.id,
                              answer: answer.text.trim(),
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('답변이 등록되었습니다.')),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '등록 실패')
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
                        : const Text('답변 등록',
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
    answer.dispose();
  }
}

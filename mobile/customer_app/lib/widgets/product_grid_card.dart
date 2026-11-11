// P2-MOB-P3: shared product grid card (extracted verbatim from home_view so
// the home grid and the channel screens render identically).
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../theme/app_theme.dart';
import '../views/product_detail_view.dart';

String gridWon(int v) =>
    '₩${v.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

class ProductGridCard extends StatelessWidget {
  final Product product;
  final void Function(Product) onAddToCart;

  const ProductGridCard(
      {super.key, required this.product, required this.onAddToCart});

  @override
  Widget build(BuildContext context) {
    final p = product;
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) =>
              ProductDetailView(productId: p.id, onAddToCart: onAddToCart),
        ),
      ),
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: Colors.grey.shade200),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: Image.network(
                      p.thumbnailUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        color: Colors.grey.shade100,
                        child: const Icon(Icons.shopping_bag,
                            size: 40, color: Colors.grey),
                      ),
                    ),
                  ),
                  if (p.discountPercent > 0)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: OlmoaColors.ruby500,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '-${p.discountPercent}%',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    p.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        gridWon(p.lowestSalePrice),
                        style: const TextStyle(
                            color: OlmoaColors.ruby500,
                            fontSize: 15,
                            fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(width: 4),
                      if (p.lowestOriginalPrice > p.lowestSalePrice)
                        Text(
                          gridWon(p.lowestOriginalPrice),
                          style: const TextStyle(
                              color: OlmoaColors.stone500,
                              fontSize: 10,
                              decoration: TextDecoration.lineThrough),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    height: 44,
                    child: ElevatedButton(
                      onPressed: () => onAddToCart(p),
                      style: ElevatedButton.styleFrom(
                        elevation: 0,
                        padding: EdgeInsets.zero,
                      ),
                      child: const Text('장바구니 담기',
                          style: TextStyle(
                              fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

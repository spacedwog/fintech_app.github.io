package fintech;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

public class FintechMain {

    public static void main(String[] args) {
        System.out.println("Objetivo: demonstrar o fluxo principal de uso das classes do sistema fintech.");
        Cliente cliente = new Cliente(1, "Ana Souza", "ana@fintech.com", "12345678901", "11999999999");

        ContaDigital conta = new ContaDigital(
                1001,
                "Conta Principal",
                cliente,
                "000123-4",
                "0001",
                "Corrente",
                new BigDecimal("1000.00")
        );

        Investimento investimento = new Investimento(
                2001,
                "Investimento Renda Fixa",
                cliente,
                10,
                "CDB",
                new BigDecimal("500.00"),
                1.2,
                12
        );

        CartaoCredito cartao = new CartaoCredito(
                3001,
                "Cartão Platinum",
                cliente,
                "411111******1111",
                "Visa",
                "Ana Souza",
                new BigDecimal("3000.00"),
                BigDecimal.ZERO
        );

        cliente.adicionarProduto(conta);
        cliente.adicionarProduto(investimento);
        cliente.adicionarProduto(cartao);

        conta.depositar(new BigDecimal("250.00"));
        investimento.aplicarInvestimento(new BigDecimal("300.00"));
        cartao.realizarCompra(new BigDecimal("150.00"));
        cartao.pagarFatura(new BigDecimal("50.00"));

        List<ProdutoFinanceiro> produtos = new ArrayList<>();
        produtos.add(conta);
        produtos.add(investimento);
        produtos.add(cartao);

        for (ProdutoFinanceiro produto : produtos) {
            System.out.println(produto.consultarTipoProduto() + " | Saldo disponível: " + produto.consultarSaldoDisponivel());
        }

        TransacaoFinanceira transacao = new TransacaoFinanceira(9001, "TRANSFERENCIA", BigDecimal.ZERO, null, "PENDENTE");
        ContaDigital contaDestino = new ContaDigital(1002, "Conta Reserva", cliente, "000987-6", "0001", "Corrente", new BigDecimal("300.00"));
        transacao.processarTransacao(conta, contaDestino, new BigDecimal("100.00"));
        System.out.println(transacao.gerarComprovante());
        transacao.cancelarTransacao();
        System.out.println("Transação cancelada. Saldo conta origem: " + conta.consultarSaldo());
    }
}

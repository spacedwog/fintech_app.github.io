package fintech;

import java.math.BigDecimal;

public class ContaDigital extends ProdutoFinanceiro {

    private String numeroConta;
    private String agencia;
    private String tipoConta;
    private BigDecimal saldo;

    public ContaDigital() {
        this.saldo = BigDecimal.ZERO;
    }

    public ContaDigital(Integer idProduto, String nomeProduto, Cliente cliente, String numeroConta, String agencia, String tipoConta, BigDecimal saldo) {
        super(idProduto, nomeProduto, cliente);
        this.numeroConta = numeroConta;
        this.agencia = agencia;
        this.tipoConta = tipoConta;
        this.saldo = validarValorMonetario(saldo);
    }

    public String getNumeroConta() {
        return numeroConta;
    }

    public String getAgencia() {
        return agencia;
    }

    public String getTipoConta() {
        return tipoConta;
    }

    public BigDecimal depositar(BigDecimal valor) {
        saldo = saldo.add(validarValorMonetario(valor));
        return saldo;
    }

    public BigDecimal sacar(BigDecimal valor) {
        BigDecimal valorValido = validarValorMonetario(valor);
        if (saldo.compareTo(valorValido) < 0) {
            throw new IllegalStateException("Saldo insuficiente para saque.");
        }
        saldo = saldo.subtract(valorValido);
        return saldo;
    }

    public BigDecimal consultarSaldo() {
        return saldo;
    }

    public void transferirPara(ContaDigital contaDestino, BigDecimal valorTransferencia) {
        if (contaDestino == null) {
            throw new IllegalArgumentException("Conta de destino não pode ser nula.");
        }
        BigDecimal valorValido = validarValorMonetario(valorTransferencia);
        sacar(valorValido);
        contaDestino.depositar(valorValido);
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        return consultarSaldo();
    }

    @Override
    public String obterTipoProduto() {
        return "Conta Digital";
    }
}

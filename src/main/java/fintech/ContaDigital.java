package fintech;

import java.math.BigDecimal;

public class ContaDigital extends ProdutoFinanceiro {

    private String numeroConta;
    private String agencia;
    private String tipoConta;
    private BigDecimal saldo;

    public ContaDigital() {
        System.out.println("Objetivo: inicializar uma conta digital com saldo zerado.");
        this.saldo = BigDecimal.ZERO;
    }

    public ContaDigital(Integer idProduto, String nomeProduto, Cliente cliente, String numeroConta, String agencia, String tipoConta, BigDecimal saldo) {
        super(idProduto, nomeProduto, cliente);
        System.out.println("Objetivo: inicializar uma conta digital com dados de identificação e saldo inicial.");
        this.numeroConta = numeroConta;
        this.agencia = agencia;
        this.tipoConta = tipoConta;
        this.saldo = validarValorMonetario(saldo);
    }

    public String getNumeroConta() {
        System.out.println("Objetivo: retornar o número da conta digital.");
        return numeroConta;
    }

    public String getAgencia() {
        System.out.println("Objetivo: retornar a agência da conta digital.");
        return agencia;
    }

    public String getTipoConta() {
        System.out.println("Objetivo: retornar o tipo da conta digital.");
        return tipoConta;
    }

    public BigDecimal depositar(BigDecimal valor) {
        System.out.println("Objetivo: adicionar valor válido ao saldo da conta digital.");
        saldo = saldo.add(validarValorMonetario(valor));
        return saldo;
    }

    public BigDecimal sacar(BigDecimal valor) {
        System.out.println("Objetivo: retirar valor válido do saldo quando houver saldo suficiente.");
        BigDecimal valorValido = validarValorMonetario(valor);
        if (saldo.compareTo(valorValido) < 0) {
            throw new IllegalStateException("Saldo insuficiente para saque.");
        }
        saldo = saldo.subtract(valorValido);
        return saldo;
    }

    public BigDecimal consultarSaldo() {
        System.out.println("Objetivo: consultar o saldo atual da conta digital.");
        return saldo;
    }

    public void transferirPara(ContaDigital contaDestino, BigDecimal valorTransferencia) {
        System.out.println("Objetivo: transferir valor válido da conta atual para uma conta de destino.");
        if (contaDestino == null) {
            throw new IllegalArgumentException("Conta de destino não pode ser nula.");
        }
        BigDecimal valorValido = validarValorMonetario(valorTransferencia);
        sacar(valorValido);
        contaDestino.depositar(valorValido);
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        System.out.println("Objetivo: retornar o saldo disponível para movimentações na conta digital.");
        return consultarSaldo();
    }

    @Override
    public String obterTipoProduto() {
        System.out.println("Objetivo: identificar o tipo do produto financeiro como conta digital.");
        return "Conta Digital";
    }
}

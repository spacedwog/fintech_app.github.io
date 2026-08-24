package fintech;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Cliente {

    private Integer idCliente;
    private String nomeCompleto;
    private String email;
    private String cpf;
    private String telefone;
    private final List<ProdutoFinanceiro> produtos;

    public Cliente() {
        this.produtos = new ArrayList<>();
    }

    public Cliente(Integer idCliente, String nomeCompleto, String email, String cpf, String telefone) {
        this.idCliente = idCliente;
        this.nomeCompleto = nomeCompleto;
        this.email = email;
        this.cpf = cpf;
        this.telefone = telefone;
        this.produtos = new ArrayList<>();
    }

    public Integer getIdCliente() {
        return idCliente;
    }

    public String getNomeCompleto() {
        return nomeCompleto;
    }

    public String getEmail() {
        return email;
    }

    public String getCpf() {
        return cpf;
    }

    public String getTelefone() {
        return telefone;
    }

    public void setTelefone(String telefone) {
        this.telefone = telefone;
    }

    public boolean cadastrarCliente() {
        return idCliente != null
                && nomeCompleto != null
                && !nomeCompleto.isBlank()
                && email != null
                && email.contains("@")
                && cpf != null
                && cpf.matches("\\d{11}");
    }

    public void atualizarCadastro(String novoEmail, String novoTelefone) {
        if (novoEmail != null && !novoEmail.isBlank()) {
            this.email = novoEmail;
        }
        if (novoTelefone != null && !novoTelefone.isBlank()) {
            this.telefone = novoTelefone;
        }
    }

    public String consultarPerfil() {
        return "Cliente{id=" + idCliente + ", nome='" + nomeCompleto + "', email='" + email + "', produtos=" + produtos.size() + "}";
    }

    public void adicionarProduto(ProdutoFinanceiro produtoFinanceiro) {
        if (produtoFinanceiro == null) {
            throw new IllegalArgumentException("Produto financeiro não pode ser nulo.");
        }
        if (produtos.contains(produtoFinanceiro)) {
            throw new IllegalArgumentException("Produto financeiro já vinculado ao cliente.");
        }
        produtoFinanceiro.vincularCliente(this);
        produtos.add(produtoFinanceiro);
    }

    public List<ProdutoFinanceiro> listarProdutos() {
        return Collections.unmodifiableList(produtos);
    }
}
